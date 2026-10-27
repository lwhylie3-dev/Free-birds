import { recomputeCentroid } from "./classify";
import { log } from "./db";
import { now, type Env } from "./env";
import { addToPlaylist, canWrite, createPrivatePlaylist, QuotaExhausted, ReauthRequired, YouTubeError } from "./youtube";

/** Most add-video items in one plan; the next plan picks up the rest. */
export const MAX_PLAN_ITEMS = 500;
const WRITES_PER_STEP = 5;
export const WRITE_UNITS = 50;

// ---------- Learning from existing playlists ----------

/**
 * Turn some of the owner's playlists into categories. Each playlist's videos become
 * confirmed examples, and organizing adds matching videos to that same playlist.
 */
export async function seedFromPlaylists(env: Env, playlistIds: string[]): Promise<number> {
  const t = now();
  let n = 0;
  for (const pid of playlistIds) {
    const pl = await env.DB.prepare("SELECT id, title, description FROM playlists WHERE id = ?").bind(pid).first<{ id: string; title: string; description: string | null }>();
    if (!pl) continue;
    const existing = await env.DB.prepare("SELECT id FROM categories WHERE seed_playlist_id = ? AND status != 'archived'").bind(pid).first();
    if (existing) continue;
    const description = pl.description?.trim() || `Videos like the ones in my "${pl.title}" playlist`;
    const byName = await env.DB.prepare("SELECT id, playlist_id FROM categories WHERE name = ?").bind(pl.title).first<{ id: number; playlist_id: string | null }>();
    if (byName) {
      await env.DB.prepare("UPDATE categories SET status = 'active', seed_playlist_id = ?, playlist_id = COALESCE(playlist_id, ?), centroid_stale = 1 WHERE id = ?")
        .bind(pid, pid, byName.id)
        .run();
    } else {
      await env.DB.prepare(
        "INSERT INTO categories (name, description, status, playlist_id, seed_playlist_id, centroid_stale, created_at) VALUES (?, ?, 'active', ?, ?, 1, ?)",
      )
        .bind(pl.title.slice(0, 60) || "Untitled playlist", description.slice(0, 300), pid, pid, t)
        .run();
    }
    n++;
  }
  if (n) await log(env, "taxonomy", "ok", `Learning from ${n} of your playlists.`);
  return n;
}

/** Mark every seeded category for refresh (after a sync may have changed playlist contents). */
export async function markSeedsStale(env: Env): Promise<void> {
  await env.DB.prepare("UPDATE categories SET centroid_stale = 1 WHERE seed_playlist_id IS NOT NULL AND status = 'active'").run();
}

/**
 * For stale categories: videos already in the seed playlist count as confirmed examples
 * (owner picks always win), then the centroid is rebuilt. Returns how many were refreshed.
 */
export async function refreshStaleCategories(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id, seed_playlist_id FROM categories WHERE centroid_stale = 1 AND status = 'active' LIMIT 10",
  ).all<{ id: number; seed_playlist_id: string | null }>();
  for (const cat of results) {
    if (cat.seed_playlist_id) {
      await env.DB.prepare(
        `INSERT INTO classifications (video_id, category_id, confidence, method, needs_review, updated_at)
         SELECT s.video_id, ?, 1, 'confirmed', 0, ? FROM video_sources s JOIN videos v ON v.id = s.video_id AND v.available = 1
         WHERE s.source = ?
         ON CONFLICT(video_id) DO UPDATE SET category_id = excluded.category_id, confidence = 1, method = 'confirmed',
           needs_review = 0, updated_at = excluded.updated_at
         WHERE classifications.method = 'auto'`,
      )
        .bind(cat.id, now(), `playlist:${cat.seed_playlist_id}`)
        .run();
    }
    await recomputeCentroid(env, cat.id);
    await env.DB.prepare("UPDATE categories SET centroid_stale = 0 WHERE id = ?").bind(cat.id).run();
  }
  return results.length;
}

// ---------- Plans ----------

export type PlanStatus = "draft" | "approved" | "applying" | "done" | "cancelled";

export interface Plan {
  id: number;
  status: PlanStatus;
  created_at: number;
  approved_at: number | null;
  finished_at: number | null;
}

export async function openPlan(env: Env): Promise<Plan | null> {
  return env.DB.prepare("SELECT * FROM plans WHERE status IN ('draft', 'approved', 'applying') ORDER BY id DESC LIMIT 1").first<Plan>();
}

/**
 * Draft a plan: for each confidently sorted video not yet in its category's playlist, add it there,
 * creating private playlists for categories that have none. Only adds; never removes, moves, or deletes.
 * Videos the owner unticked in an earlier approved plan are not proposed again.
 */
export async function buildPlan(env: Env): Promise<{ planId: number | null; adds: number; creates: number }> {
  const open = await openPlan(env);
  if (open && open.status !== "draft") throw new Error("A plan is already approved and running. Let it finish or cancel it first.");
  if (open) await env.DB.prepare("DELETE FROM plans WHERE id = ?").bind(open.id).run();

  const { results: adds } = await env.DB.prepare(
    `SELECT c.video_id, c.category_id, cat.playlist_id FROM classifications c
     JOIN categories cat ON cat.id = c.category_id AND cat.status = 'active'
     JOIN videos v ON v.id = c.video_id AND v.available = 1
     WHERE c.needs_review = 0
       AND (cat.playlist_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM video_sources s WHERE s.video_id = c.video_id AND s.source = 'playlist:' || cat.playlist_id))
       AND NOT EXISTS (
         SELECT 1 FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
         WHERE pi.video_id = c.video_id AND pi.category_id = c.category_id AND pi.action = 'add_video'
           AND pi.include = 0 AND p.status = 'done')
     ORDER BY c.method = 'auto', c.confidence DESC
     LIMIT ?`,
  )
    .bind(MAX_PLAN_ITEMS)
    .all<{ video_id: string; category_id: number; playlist_id: string | null }>();
  if (adds.length === 0) return { planId: null, adds: 0, creates: 0 };

  const t = now();
  const plan = await env.DB.prepare("INSERT INTO plans (status, created_at) VALUES ('draft', ?) RETURNING id").bind(t).first<{ id: number }>();
  const planId = plan!.id;
  const needCreate = [...new Set(adds.filter((a) => !a.playlist_id).map((a) => a.category_id))];
  const stmts = [
    ...needCreate.map((cid) =>
      env.DB.prepare("INSERT INTO plan_items (plan_id, action, category_id, updated_at) VALUES (?, 'create_playlist', ?, ?)").bind(planId, cid, t),
    ),
    ...adds.map((a) =>
      env.DB.prepare("INSERT INTO plan_items (plan_id, action, category_id, video_id, updated_at) VALUES (?, 'add_video', ?, ?, ?)").bind(
        planId,
        a.category_id,
        a.video_id,
        t,
      ),
    ),
  ];
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  await log(env, "plan", "info", `Drafted plan #${planId}: ${needCreate.length} new private playlists, ${adds.length} videos to add. Waiting for your approval.`);
  return { planId, adds: adds.length, creates: needCreate.length };
}

/**
 * Approve a draft. Only the ticked videos (in ticked categories) are applied; a category with
 * nothing ticked doesn't get a playlist created.
 */
export async function approvePlan(env: Env, planId: number, keepItemIds: Set<number>, keepCategoryIds: Set<number>): Promise<number> {
  const plan = await env.DB.prepare("SELECT status FROM plans WHERE id = ?").bind(planId).first<{ status: PlanStatus }>();
  if (plan?.status !== "draft") throw new Error("This plan can't be approved (it isn't a draft anymore).");
  const { results } = await env.DB.prepare("SELECT id, action, category_id FROM plan_items WHERE plan_id = ?").bind(planId).all<{
    id: number;
    action: string;
    category_id: number;
  }>();
  const keepAdd = (r: { id: number; category_id: number }) => keepCategoryIds.has(r.category_id) && keepItemIds.has(r.id);
  const catsWithAdds = new Set(results.filter((r) => r.action === "add_video" && keepAdd(r)).map((r) => r.category_id));
  const include = (r: { id: number; action: string; category_id: number }) =>
    r.action === "create_playlist" ? catsWithAdds.has(r.category_id) : keepAdd(r);

  const t = now();
  const stmts = results.map((r) =>
    include(r)
      ? env.DB.prepare("UPDATE plan_items SET include = 1, updated_at = ? WHERE id = ?").bind(t, r.id)
      : env.DB.prepare("UPDATE plan_items SET include = 0, status = 'skipped', error = 'Left out by you', updated_at = ? WHERE id = ?").bind(t, r.id),
  );
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  const totalAdds = results.filter((r) => r.action === "add_video").length;
  const approved = results.filter((r) => r.action === "add_video" && include(r)).length;
  await env.DB.prepare("UPDATE plans SET status = 'approved', approved_at = ? WHERE id = ?").bind(t, planId).run();
  await log(env, "plan", "ok", `You approved plan #${planId}: ${approved} videos to add, ${totalAdds - approved} left out.`);
  return approved;
}

export async function cancelPlan(env: Env, planId: number): Promise<void> {
  await env.DB.prepare("UPDATE plans SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('draft', 'approved', 'applying')")
    .bind(now(), planId)
    .run();
  await env.DB.prepare("UPDATE plan_items SET status = 'skipped', error = 'Plan cancelled', updated_at = ? WHERE plan_id = ? AND status = 'pending'")
    .bind(now(), planId)
    .run();
  await log(env, "plan", "info", `Plan #${planId} cancelled. Changes already made stay in place.`);
}

/** Existing playlists the plan will add to, which should be re-read before writing to avoid duplicates. */
export async function planTargetPlaylists(env: Env, planId: number): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT cat.playlist_id FROM plan_items pi JOIN categories cat ON cat.id = pi.category_id
     WHERE pi.plan_id = ? AND pi.include = 1 AND pi.action = 'add_video' AND cat.playlist_id IS NOT NULL`,
  )
    .bind(planId)
    .all<{ playlist_id: string }>();
  return results.map((r) => r.playlist_id);
}

interface ItemRow {
  id: number;
  action: "create_playlist" | "add_video";
  category_id: number;
  video_id: string | null;
  name: string;
  description: string;
  playlist_id: string | null;
  cat_status: string;
}

async function finishItem(env: Env, id: number, status: "done" | "skipped" | "failed", error: string | null = null) {
  await env.DB.prepare("UPDATE plan_items SET status = ?, error = ?, updated_at = ? WHERE id = ?").bind(status, error, now(), id).run();
}

/**
 * Apply up to a few approved writes. `beforeApply` runs once when the plan starts (re-reading target
 * playlists). Returns a progress message, or null if no approved plan is waiting.
 */
export async function applyStep(env: Env, beforeApply: (playlistIds: string[]) => Promise<void>): Promise<string | null> {
  const plan = await env.DB.prepare("SELECT id, status FROM plans WHERE status IN ('approved', 'applying') ORDER BY id LIMIT 1").first<{
    id: number;
    status: PlanStatus;
  }>();
  if (!plan) return null;
  if (!(await canWrite(env))) throw new ReauthRequired("Organizing needs permission to manage playlists. Tap 'Enable organizing' in Settings.");

  if (plan.status === "approved") {
    await env.DB.prepare("UPDATE plans SET status = 'applying' WHERE id = ?").bind(plan.id).run();
    await beforeApply(await planTargetPlaylists(env, plan.id));
    return `Plan #${plan.id}: re-checking your playlists before making changes…`;
  }

  // Playlist creation first, so adds have somewhere to go.
  const { results: items } = await env.DB.prepare(
    `SELECT pi.id, pi.action, pi.category_id, pi.video_id, cat.name, cat.description, cat.playlist_id, cat.status AS cat_status
     FROM plan_items pi JOIN categories cat ON cat.id = pi.category_id
     WHERE pi.plan_id = ? AND pi.include = 1 AND pi.status = 'pending'
     ORDER BY pi.action = 'add_video', pi.id LIMIT ?`,
  )
    .bind(plan.id, WRITES_PER_STEP)
    .all<ItemRow>();

  if (items.length === 0) {
    const counts = await env.DB.prepare(
      `SELECT SUM(status = 'done' AND action = 'add_video') AS added, SUM(status = 'done' AND action = 'create_playlist') AS created,
         SUM(status = 'skipped' AND include = 1) AS skipped, SUM(status = 'failed') AS failed FROM plan_items WHERE plan_id = ?`,
    )
      .bind(plan.id)
      .first<{ added: number; created: number; skipped: number; failed: number }>();
    await env.DB.prepare("UPDATE plans SET status = 'done', finished_at = ? WHERE id = ?").bind(now(), plan.id).run();
    const msg = `Plan #${plan.id} finished: ${counts?.created ?? 0} playlists created, ${counts?.added ?? 0} videos added, ${counts?.skipped ?? 0} already there, ${counts?.failed ?? 0} failed.`;
    await log(env, "plan", counts?.failed ? "warn" : "ok", msg);
    return msg;
  }

  let done = 0;
  for (const it of items) {
    if (it.cat_status !== "active") {
      await finishItem(env, it.id, "skipped", "Category was archived");
      continue;
    }
    try {
      if (it.action === "create_playlist") {
        if (it.playlist_id) {
          await finishItem(env, it.id, "skipped", "Category already has a playlist");
          continue;
        }
        const pl = await createPrivatePlaylist(env, it.name, `${it.description}\n\nOrganized by Noxara YT.`.trim());
        const t = now();
        await env.DB.batch([
          env.DB.prepare("UPDATE categories SET playlist_id = ? WHERE id = ?").bind(pl.id, it.category_id),
          env.DB.prepare("INSERT OR IGNORE INTO playlists (id, title, description, item_count, privacy, synced_at) VALUES (?, ?, ?, 0, 'private', ?)").bind(
            pl.id,
            it.name,
            it.description,
            t,
          ),
        ]);
        await finishItem(env, it.id, "done");
        await log(env, "plan", "ok", `Created private playlist "${it.name}".`, WRITE_UNITS);
      } else {
        // The playlist may have been created earlier in this same batch.
        const playlistId =
          it.playlist_id ??
          (await env.DB.prepare("SELECT playlist_id FROM categories WHERE id = ?").bind(it.category_id).first<{ playlist_id: string | null }>())?.playlist_id;
        if (!playlistId) {
          await finishItem(env, it.id, "failed", "The category's playlist couldn't be created");
          continue;
        }
        const source = `playlist:${playlistId}`;
        const already = await env.DB.prepare("SELECT 1 FROM video_sources WHERE video_id = ? AND source = ?").bind(it.video_id, source).first();
        if (already) {
          await finishItem(env, it.id, "skipped", "Already in the playlist");
          continue;
        }
        await addToPlaylist(env, playlistId, it.video_id!);
        await env.DB.batch([
          env.DB.prepare("INSERT OR IGNORE INTO video_sources (video_id, source, seen_at) VALUES (?, ?, ?)").bind(it.video_id, source, now()),
          env.DB.prepare("UPDATE plan_items SET status = 'done', error = NULL, updated_at = ? WHERE id = ?").bind(now(), it.id),
        ]);
        await log(env, "plan", "ok", `Added ${it.video_id} to "${it.name}".`, WRITE_UNITS);
      }
      done++;
    } catch (err) {
      if (err instanceof QuotaExhausted || err instanceof ReauthRequired) throw err;
      const msg = err instanceof YouTubeError ? err.message : String(err);
      await finishItem(env, it.id, "failed", msg.slice(0, 300));
      await log(env, "plan", "error", `Plan #${plan.id} item failed: ${msg}`);
    }
  }
  const left = await env.DB.prepare("SELECT COUNT(*) n FROM plan_items WHERE plan_id = ? AND include = 1 AND status = 'pending'")
    .bind(plan.id)
    .first<{ n: number }>();
  return `Plan #${plan.id}: ${done} changes made, ${left?.n ?? 0} to go.`;
}
