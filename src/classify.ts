import { log } from "./db";
import { now, type Env } from "./env";
import { decodeVec, encodeVec, mean, predict, prototype, REVIEW_THRESHOLD, type Prototype } from "./vectors";

// Cloudflare Workers AI, covered by the free daily allocation.
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
export const LLM_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export class AiLimitReached extends Error {}

export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  try {
    const out = (await env.AI.run(EMBED_MODEL, { text: texts })) as { data?: number[][] };
    if (!out.data || out.data.length !== texts.length) throw new Error("Unexpected embedding response");
    return out.data;
  } catch (err) {
    const msg = String(err);
    if (/limit|quota|neuron|429|capacity/i.test(msg)) throw new AiLimitReached(msg);
    throw err;
  }
}

export interface VideoTextFields {
  title: string;
  channel_title: string | null;
  tags: string | null;
  description: string | null;
}

export function videoText(v: VideoTextFields): string {
  const tags = v.tags ? (JSON.parse(v.tags) as string[]).slice(0, 15).join(", ") : "";
  return [v.title, v.channel_title ? `Channel: ${v.channel_title}` : "", tags ? `Tags: ${tags}` : "", (v.description ?? "").slice(0, 500)]
    .filter(Boolean)
    .join("\n");
}

export const categoryText = (name: string, description: string) => `${name}: ${description}`;

interface CategoryRow {
  id: number;
  embedding: string | null;
  centroid: string | null;
  example_count: number;
}

export async function loadPrototypes(env: Env): Promise<Prototype[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, embedding, centroid, example_count FROM categories WHERE status = 'active' AND embedding IS NOT NULL",
  ).all<CategoryRow>();
  return results.map((c) => ({
    categoryId: c.id,
    vec: prototype(decodeVec(c.embedding!), c.centroid ? decodeVec(c.centroid) : null, c.example_count),
  }));
}

/** Embed any active category missing an embedding. */
export async function embedCategories(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id, name, description FROM categories WHERE status = 'active' AND embedding IS NULL").all<{
    id: number;
    name: string;
    description: string;
  }>();
  if (results.length === 0) return;
  const vecs = await embed(env, results.map((c) => categoryText(c.name, c.description)));
  await env.DB.batch(
    results.map((c, i) => env.DB.prepare("UPDATE categories SET embedding = ? WHERE id = ?").bind(encodeVec(vecs[i]!), c.id)),
  );
}

/** Rebuild a category's example centroid from owner-confirmed and corrected videos. */
export async function recomputeCentroid(env: Env, categoryId: number): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT v.embedding FROM classifications c JOIN videos v ON v.id = c.video_id
     WHERE c.category_id = ? AND c.method IN ('corrected', 'confirmed') AND v.embedding IS NOT NULL
     ORDER BY c.updated_at DESC LIMIT 300`,
  )
    .bind(categoryId)
    .all<{ embedding: string }>();
  const centroid = mean(results.map((r) => decodeVec(r.embedding)));
  await env.DB.prepare("UPDATE categories SET centroid = ?, example_count = ? WHERE id = ?")
    .bind(centroid ? encodeVec(centroid) : null, results.length, categoryId)
    .run();
}

/** Embed up to `limit` videos without embeddings. Returns how many were processed. */
export async function embedPendingVideos(env: Env, limit = 50): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id, title, channel_title, tags, description FROM videos WHERE embedding IS NULL AND available = 1 AND details_fetched = 1 LIMIT ?",
  )
    .bind(limit)
    .all<VideoTextFields & { id: string }>();
  if (results.length === 0) return 0;
  const vecs = await embed(env, results.map(videoText));
  await env.DB.batch(results.map((v, i) => env.DB.prepare("UPDATE videos SET embedding = ? WHERE id = ?").bind(encodeVec(vecs[i]!), v.id)));
  return results.length;
}

/** Auto-classify up to `limit` embedded videos that have no classification yet. */
export async function classifyPendingVideos(env: Env, limit = 100): Promise<number> {
  const protos = await loadPrototypes(env);
  if (protos.length === 0) return 0;
  const { results } = await env.DB.prepare(
    `SELECT v.id, v.embedding FROM videos v LEFT JOIN classifications c ON c.video_id = v.id
     WHERE v.embedding IS NOT NULL AND c.video_id IS NULL LIMIT ?`,
  )
    .bind(limit)
    .all<{ id: string; embedding: string }>();
  if (results.length === 0) return 0;
  const t = now();
  const stmts = results.flatMap((v) => {
    const p = predict(decodeVec(v.embedding), protos);
    if (!p) return [];
    return [
      env.DB.prepare(
        "INSERT INTO classifications (video_id, category_id, confidence, method, needs_review, updated_at) VALUES (?, ?, ?, 'auto', ?, ?)",
      ).bind(v.id, p.categoryId, p.confidence, p.confidence < REVIEW_THRESHOLD ? 1 : 0, t),
    ];
  });
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

/** Drop automatic labels so they are recomputed with the current categories and examples. */
export async function resetAutoClassifications(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM classifications WHERE method = 'auto'").run();
}

/** Owner sets or confirms a video's category; this is what the classifier learns from. */
export async function correct(env: Env, videoId: string, toCategoryId: number): Promise<void> {
  const prev = await env.DB.prepare("SELECT category_id FROM classifications WHERE video_id = ?").bind(videoId).first<{ category_id: number | null }>();
  const fromId = prev?.category_id ?? null;
  const method = fromId === toCategoryId ? "confirmed" : "corrected";
  const t = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO classifications (video_id, category_id, confidence, method, needs_review, updated_at) VALUES (?, ?, 1, ?, 0, ?)
       ON CONFLICT(video_id) DO UPDATE SET category_id = excluded.category_id, confidence = 1, method = excluded.method, needs_review = 0, updated_at = excluded.updated_at`,
    ).bind(videoId, toCategoryId, method, t),
    env.DB.prepare("INSERT INTO corrections (video_id, from_category_id, to_category_id, created_at) VALUES (?, ?, ?, ?)").bind(
      videoId,
      fromId,
      toCategoryId,
      t,
    ),
  ]);
  await recomputeCentroid(env, toCategoryId);
  if (fromId !== null && fromId !== toCategoryId) await recomputeCentroid(env, fromId);
}

export interface ProposedCategory {
  name: string;
  description: string;
}

export function parseCategoryJson(text: string): ProposedCategory[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: ProposedCategory[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const name = String((item as Record<string, unknown>).name ?? "").trim().slice(0, 60);
    const description = String((item as Record<string, unknown>).description ?? "").trim().slice(0, 300);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, description });
  }
  return out.slice(0, 20);
}

/** Ask the LLM for a taxonomy from a sample of the library. Results are saved as 'proposed' for owner approval. */
export async function proposeTaxonomy(env: Env): Promise<number> {
  const { results: vids } = await env.DB.prepare(
    "SELECT title, channel_title FROM videos WHERE available = 1 ORDER BY RANDOM() LIMIT 150",
  ).all<{ title: string; channel_title: string | null }>();
  if (vids.length < 5) throw new Error("Import at least a few videos before proposing categories.");
  const { results: pls } = await env.DB.prepare("SELECT title FROM playlists LIMIT 50").all<{ title: string }>();

  const prompt = [
    "You organize a person's YouTube library. Based on the videos and playlists below, propose 8 to 16 interest categories",
    "that would make good private playlists. Categories should be specific to this person's interests, mutually distinct,",
    "and broad enough to hold several videos each.",
    'Reply with ONLY a JSON array like [{"name": "Short Name", "description": "One sentence describing what belongs here."}].',
    "",
    "Existing playlists:",
    ...pls.map((p) => `- ${p.title}`),
    "",
    "Sample of videos (title | channel):",
    ...vids.map((v) => `- ${v.title} | ${v.channel_title ?? ""}`),
  ].join("\n");

  let text: string;
  try {
    const out = (await env.AI.run(LLM_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
    })) as { response?: unknown };
    text = typeof out.response === "string" ? out.response : JSON.stringify(out.response ?? "");
  } catch (err) {
    if (/limit|quota|neuron|429/i.test(String(err))) throw new AiLimitReached(String(err));
    throw err;
  }
  const cats = parseCategoryJson(text);
  if (cats.length === 0) {
    await log(env, "taxonomy", "error", "The AI reply did not contain usable categories. Try again or add categories by hand.");
    return 0;
  }
  await env.DB.prepare("DELETE FROM categories WHERE status = 'proposed'").run();
  const t = now();
  await env.DB.batch(
    cats.map((c) =>
      env.DB.prepare("INSERT OR IGNORE INTO categories (name, description, status, created_at) VALUES (?, ?, 'proposed', ?)").bind(
        c.name,
        c.description,
        t,
      ),
    ),
  );
  await log(env, "taxonomy", "ok", `Proposed ${cats.length} categories for review.`);
  return cats.length;
}
