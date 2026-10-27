import { decrypt, encrypt } from "./crypto";
import { addQuota, log, quotaUsedToday } from "./db";
import { now, type Env } from "./env";

const API = "https://www.googleapis.com/youtube/v3";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Default YouTube Data API quota; we stop short of it to leave headroom. */
export const DAILY_QUOTA = 10_000;
export const QUOTA_RESERVE = 500;

export class QuotaExhausted extends Error {}
export class ReauthRequired extends Error {}
export class YouTubeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface TokenRow {
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires_at: number | null;
}

export async function isConnected(env: Env): Promise<boolean> {
  return (await env.DB.prepare("SELECT 1 FROM oauth_tokens WHERE id = 1").first()) !== null;
}

async function refreshAccessToken(env: Env, row: TokenRow): Promise<string> {
  const refreshToken = await decrypt(env.APP_SECRET, row.refresh_token_enc);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    if (body.error === "invalid_grant") {
      await log(env, "auth", "error", "Google refresh token was revoked or expired. Reconnect YouTube.");
      throw new ReauthRequired("Reconnect YouTube");
    }
    throw new YouTubeError(`Token refresh failed: ${body.error ?? res.status}`, res.status);
  }
  const expiresAt = now() + (body.expires_in ?? 3600) * 1000;
  await env.DB.prepare("UPDATE oauth_tokens SET access_token_enc = ?, access_expires_at = ?, updated_at = ? WHERE id = 1")
    .bind(await encrypt(env.APP_SECRET, body.access_token), expiresAt, now())
    .run();
  return body.access_token;
}

async function accessToken(env: Env, forceRefresh = false): Promise<string> {
  const row = await env.DB.prepare("SELECT refresh_token_enc, access_token_enc, access_expires_at FROM oauth_tokens WHERE id = 1").first<TokenRow>();
  if (!row) throw new ReauthRequired("YouTube is not connected");
  if (!forceRefresh && row.access_token_enc && (row.access_expires_at ?? 0) > now() + 60_000) {
    return decrypt(env.APP_SECRET, row.access_token_enc);
  }
  return refreshAccessToken(env, row);
}

/** GET a YouTube Data API resource, accounting quota and retrying once on an expired token. */
export async function ytGet<T>(env: Env, resource: string, params: Record<string, string>, units = 1): Promise<T> {
  if ((await quotaUsedToday(env)) + units > DAILY_QUOTA - QUOTA_RESERVE) {
    throw new QuotaExhausted("Daily YouTube quota budget reached; work resumes after midnight Pacific time.");
  }
  const url = `${API}/${resource}?${new URLSearchParams(params)}`;
  let token = await accessToken(env);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    await addQuota(env, units);
    if (res.ok) return (await res.json()) as T;

    const text = await res.text();
    if (res.status === 401 && attempt === 0) {
      token = await accessToken(env, true);
      continue;
    }
    if (res.status === 403 && /quotaExceeded|dailyLimitExceeded/.test(text)) {
      throw new QuotaExhausted("YouTube reported the daily quota is exhausted.");
    }
    if (res.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    throw new YouTubeError(`YouTube ${resource} failed (${res.status}): ${text.slice(0, 300)}`, res.status);
  }
  throw new YouTubeError(`YouTube ${resource} failed after retries`, 0);
}

export interface Page<T> {
  items: T[];
  nextPageToken?: string;
}

export interface ChannelResource {
  id: string;
  snippet: { title: string };
  contentDetails: { relatedPlaylists: { likes?: string } };
}

export interface PlaylistResource {
  id: string;
  snippet: { title: string; description: string };
  contentDetails: { itemCount: number };
  status?: { privacyStatus: string };
}

export interface PlaylistItemResource {
  snippet: { title: string; resourceId: { videoId: string } };
  status?: { privacyStatus: string };
}

export interface VideoResource {
  id: string;
  snippet: {
    title: string;
    description: string;
    channelId: string;
    channelTitle: string;
    tags?: string[];
    categoryId?: string;
    publishedAt: string;
    thumbnails?: Record<string, { url: string }>;
  };
  contentDetails?: { duration: string };
}

export const getMyChannel = (env: Env) =>
  ytGet<Page<ChannelResource>>(env, "channels", { part: "snippet,contentDetails", mine: "true" });

export const listMyPlaylists = (env: Env, pageToken?: string) =>
  ytGet<Page<PlaylistResource>>(env, "playlists", {
    part: "snippet,contentDetails,status",
    mine: "true",
    maxResults: "50",
    ...(pageToken ? { pageToken } : {}),
  });

export const listPlaylistItems = (env: Env, playlistId: string, pageToken?: string) =>
  ytGet<Page<PlaylistItemResource>>(env, "playlistItems", {
    part: "snippet,status",
    playlistId,
    maxResults: "50",
    ...(pageToken ? { pageToken } : {}),
  });

/** Up to 50 ids per call, 1 unit. */
export const getVideos = (env: Env, ids: string[]) =>
  ytGet<Page<VideoResource>>(env, "videos", { part: "snippet,contentDetails", id: ids.join(","), maxResults: "50" });

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Extract a video id from any common YouTube URL form, or a bare id. */
export function parseVideoId(input: string): string | null {
  const text = input.trim();
  if (VIDEO_ID.test(text)) return text;
  const match = text.match(/https?:\/\/\S+/);
  if (!match) return null;
  let url: URL;
  try {
    url = new URL(match[0]);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v");
    if (!id) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && ["shorts", "live", "embed", "v"].includes(parts[0]!)) id = parts[1]!;
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}
