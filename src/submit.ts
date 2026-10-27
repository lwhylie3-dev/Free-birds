import { classifyPendingVideos, embedPendingVideos } from "./classify";
import { log } from "./db";
import { now, type Env } from "./env";
import { updateVideoStmt } from "./sync";
import { getVideos, parseVideoId } from "./youtube";

export interface SubmitResult {
  ok: boolean;
  duplicate: boolean;
  videoId?: string;
  title?: string;
  category?: string | null;
  confidence?: number;
  message: string;
}

async function describe(env: Env, videoId: string) {
  return env.DB.prepare(
    `SELECT v.title, cat.name AS category, c.confidence FROM videos v
     LEFT JOIN classifications c ON c.video_id = v.id LEFT JOIN categories cat ON cat.id = c.category_id
     WHERE v.id = ?`,
  )
    .bind(videoId)
    .first<{ title: string; category: string | null; confidence: number | null }>();
}

/** Add a shared video: dedupe, fetch metadata, analyze and classify it right away. */
export async function submitVideo(env: Env, input: string): Promise<SubmitResult> {
  const videoId = parseVideoId(input);
  if (!videoId) return { ok: false, duplicate: false, message: "That doesn't look like a YouTube video link." };

  const t = now();
  const existing = await env.DB.prepare("SELECT id FROM videos WHERE id = ?").bind(videoId).first();
  if (existing) {
    await env.DB.prepare("INSERT OR IGNORE INTO video_sources (video_id, source, seen_at) VALUES (?, 'submitted', ?)").bind(videoId, t).run();
    const d = await describe(env, videoId);
    return {
      ok: true,
      duplicate: true,
      videoId,
      title: d?.title,
      category: d?.category ?? null,
      message: `Already in your library${d?.category ? ` under ${d.category}` : ""}.`,
    };
  }

  const page = await getVideos(env, [videoId]);
  const video = page.items[0];
  if (!video) return { ok: false, duplicate: false, videoId, message: "YouTube says that video is private, deleted, or doesn't exist." };

  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO videos (id, title, added_at, synced_at) VALUES (?, ?, ?, ?)").bind(videoId, video.snippet.title, t, t),
    updateVideoStmt(env, video),
    env.DB.prepare("INSERT OR IGNORE INTO video_sources (video_id, source, seen_at) VALUES (?, 'submitted', ?)").bind(videoId, t),
  ]);

  // Best effort: if the free AI allowance is spent, the cron job finishes this later.
  try {
    await embedPendingVideos(env, 5);
    await classifyPendingVideos(env, 5);
  } catch (err) {
    await log(env, "submit", "warn", `Saved ${videoId}; analysis deferred: ${String(err).slice(0, 200)}`);
  }
  const d = await describe(env, videoId);
  await log(env, "submit", "ok", `Added "${video.snippet.title}"${d?.category ? ` → ${d.category}` : ""}.`, 1);
  return {
    ok: true,
    duplicate: false,
    videoId,
    title: video.snippet.title,
    category: d?.category ?? null,
    confidence: d?.confidence ?? undefined,
    message: d?.category ? `Added to ${d.category}.` : "Added. It will be sorted once categories are approved.",
  };
}
