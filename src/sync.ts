import { AiLimitReached, classifyPendingVideos, embedCategories, embedPendingVideos } from "./classify";
import { clearState, getSetting, getState, log, setSetting, setState } from "./db";
import { now, type Env } from "./env";
import {
  getMyChannel,
  getVideos,
  isConnected,
  listMyPlaylists,
  listPlaylistItems,
  QuotaExhausted,
  ReauthRequired,
  type VideoResource,
} from "./youtube";

type Task = { kind: "playlists" } | { kind: "items"; playlistId: string; source: string; stopWhenKnown: boolean };

interface SyncState {
  queue: Task[];
  pageToken?: string;
  full: boolean;
  startedAt: number;
  pages: number;
  newVideos: number;
}

const SYNC_KEY = "sync";

export async function startSync(env: Env, full: boolean): Promise<void> {
  const ch = await getMyChannel(env);
  const channel = ch.items[0];
  if (!channel) throw new Error("This Google account has no YouTube channel, so there are no likes or playlists to read.");
  const likes = channel.contentDetails.relatedPlaylists.likes;
  if (likes) await setSetting(env, "likes_playlist_id", likes);
  await env.DB.prepare("UPDATE oauth_tokens SET channel_id = ?, channel_title = ? WHERE id = 1").bind(channel.id, channel.snippet.title).run();

  const queue: Task[] = [{ kind: "playlists" }];
  if (likes) queue.push({ kind: "items", playlistId: likes, source: "liked", stopWhenKnown: !full });
  await setState(env, SYNC_KEY, { queue, full, startedAt: now(), pages: 0, newVideos: 0 } satisfies SyncState);
  await setSetting(env, "last_sync_started", String(now()));
  await log(env, "sync", "info", full ? "Full sync started." : "Scheduled sync started.", 1);
}

export async function isSyncRunning(env: Env): Promise<boolean> {
  return (await getState(env, SYNC_KEY)) !== null;
}

/** Process up to `maxPages` API pages of the current sync and report progress. */
async function syncStep(env: Env, maxPages = 4): Promise<string> {
  const state = await getState<SyncState>(env, SYNC_KEY);
  if (!state) return "No sync running.";
  const likes = await getSetting(env, "likes_playlist_id");

  for (let i = 0; i < maxPages; i++) {
    const task = state.queue[0];
    if (!task) break;
    const t = now();

    if (task.kind === "playlists") {
      const page = await listMyPlaylists(env, state.pageToken);
      await env.DB.batch(
        page.items.map((p) =>
          env.DB.prepare(
            `INSERT INTO playlists (id, title, description, item_count, privacy, synced_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description,
               item_count = excluded.item_count, privacy = excluded.privacy, synced_at = excluded.synced_at`,
          ).bind(p.id, p.snippet.title, p.snippet.description, p.contentDetails.itemCount, p.status?.privacyStatus ?? null, t),
        ),
      );
      for (const p of page.items) {
        if (p.id !== likes) state.queue.push({ kind: "items", playlistId: p.id, source: `playlist:${p.id}`, stopWhenKnown: false });
      }
      state.pageToken = page.nextPageToken;
    } else {
      const page = await listPlaylistItems(env, task.playlistId, state.pageToken);
      const ids = page.items.map((it) => it.snippet.resourceId.videoId).filter(Boolean);
      if (ids.length) {
        const res = await env.DB.batch([
          ...page.items.map((it) =>
            env.DB.prepare(
              "INSERT OR IGNORE INTO videos (id, title, added_at, synced_at) VALUES (?, ?, ?, ?)",
            ).bind(it.snippet.resourceId.videoId, it.snippet.title, t, t),
          ),
          ...ids.map((id) =>
            env.DB.prepare(
              "INSERT INTO video_sources (video_id, source, seen_at) VALUES (?, ?, ?) ON CONFLICT(video_id, source) DO UPDATE SET seen_at = excluded.seen_at",
            ).bind(id, task.source, t),
          ),
        ]);
        const inserted = res.slice(0, page.items.length).reduce((n, r) => n + (r.meta.changes ?? 0), 0);
        state.newVideos += inserted;
        // Likes are newest first, so a scheduled sync can stop at the first page with nothing new.
        if (task.stopWhenKnown && inserted === 0) page.nextPageToken = undefined;
      }
      state.pageToken = page.nextPageToken;
    }

    state.pages++;
    if (!state.pageToken) state.queue.shift();
  }

  if (state.queue.length === 0) {
    await clearState(env, SYNC_KEY);
    await log(env, "sync", "ok", `Sync finished: ${state.pages} pages read, ${state.newVideos} new videos.`, state.pages);
    return `Sync finished, ${state.newVideos} new videos.`;
  }
  await setState(env, SYNC_KEY, state);
  return `Syncing… ${state.pages} pages read, ${state.newVideos} new videos so far.`;
}

export function videoColumns(v: VideoResource) {
  const thumbs = v.snippet.thumbnails ?? {};
  const thumb = thumbs.medium?.url ?? thumbs.default?.url ?? null;
  return {
    title: v.snippet.title,
    channel_id: v.snippet.channelId,
    channel_title: v.snippet.channelTitle,
    description: v.snippet.description.slice(0, 2000),
    tags: JSON.stringify((v.snippet.tags ?? []).slice(0, 30)),
    yt_category_id: v.snippet.categoryId ?? null,
    duration: v.contentDetails?.duration ?? null,
    published_at: v.snippet.publishedAt,
    thumbnail: thumb,
  };
}

export function updateVideoStmt(env: Env, v: VideoResource) {
  const c = videoColumns(v);
  return env.DB.prepare(
    `UPDATE videos SET title = ?, channel_id = ?, channel_title = ?, description = ?, tags = ?, yt_category_id = ?,
       duration = ?, published_at = ?, thumbnail = ?, available = 1, details_fetched = 1, synced_at = ? WHERE id = ?`,
  ).bind(c.title, c.channel_id, c.channel_title, c.description, c.tags, c.yt_category_id, c.duration, c.published_at, c.thumbnail, now(), v.id);
}

/** Fetch full metadata for up to 50 videos that only have a playlist-item stub. */
async function detailsStep(env: Env): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id FROM videos WHERE details_fetched = 0 LIMIT 50").all<{ id: string }>();
  if (results.length === 0) return 0;
  const ids = results.map((r) => r.id);
  const page = await getVideos(env, ids);
  const found = new Set(page.items.map((v) => v.id));
  const missing = ids.filter((id) => !found.has(id));
  await env.DB.batch([
    ...page.items.map((v) => updateVideoStmt(env, v)),
    // Deleted or private videos: keep the row but flag it.
    ...missing.map((id) => env.DB.prepare("UPDATE videos SET available = 0, details_fetched = 1, synced_at = ? WHERE id = ?").bind(now(), id)),
  ]);
  if (missing.length) await log(env, "sync", "warn", `${missing.length} videos are deleted or private and were flagged unavailable.`);
  return ids.length;
}

export type StepStatus = "working" | "idle" | "blocked";

/** One bounded unit of background work: sync → details → embed → classify. */
export async function runStep(env: Env): Promise<{ status: StepStatus; message: string }> {
  try {
    if (!(await isConnected(env))) return { status: "blocked", message: "Connect YouTube first." };
    if (await isSyncRunning(env)) return { status: "working", message: await syncStep(env) };
    const fetched = await detailsStep(env);
    if (fetched) return { status: "working", message: `Fetched details for ${fetched} videos.` };
    await embedCategories(env);
    const embedded = await embedPendingVideos(env);
    if (embedded) return { status: "working", message: `Analyzed ${embedded} videos.` };
    const classified = await classifyPendingVideos(env);
    if (classified) return { status: "working", message: `Sorted ${classified} videos.` };
    return { status: "idle", message: "All caught up." };
  } catch (err) {
    if (err instanceof QuotaExhausted || err instanceof ReauthRequired) {
      await log(env, "work", "warn", err.message);
      return { status: "blocked", message: err.message };
    }
    if (err instanceof AiLimitReached) {
      const message = "Today's free AI allowance is used up; analysis resumes automatically tomorrow.";
      await log(env, "work", "warn", `${message} (${err.message.slice(0, 200)})`);
      return { status: "blocked", message };
    }
    await log(env, "work", "error", String(err));
    return { status: "blocked", message: `Error: ${String(err).slice(0, 200)}` };
  }
}

const DAY = 24 * 60 * 60 * 1000;

/** Cron entry: start the daily sync when due, then do a few steps of work. */
export async function scheduled(env: Env): Promise<void> {
  if (!(await isConnected(env))) return;
  try {
    const last = Number((await getSetting(env, "last_sync_started")) ?? 0);
    if (!(await isSyncRunning(env)) && now() - last > DAY - 30 * 60 * 1000) await startSync(env, false);
  } catch (err) {
    await log(env, "cron", "error", `Could not start scheduled sync: ${String(err)}`);
    return;
  }
  for (let i = 0; i < 4; i++) {
    const r = await runStep(env);
    if (r.status !== "working") break;
  }
}
