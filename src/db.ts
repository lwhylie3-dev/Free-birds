import { now, type Env } from "./env";

export type LogStatus = "info" | "ok" | "warn" | "error";

export async function log(env: Env, kind: string, status: LogStatus, message: string, units = 0): Promise<void> {
  await env.DB.prepare("INSERT INTO sync_log (ts, kind, status, message, units) VALUES (?, ?, ?, ?, ?)")
    .bind(now(), kind, status, message.slice(0, 1000), units)
    .run();
}

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export async function getState<T>(env: Env, key: string): Promise<T | null> {
  const row = await env.DB.prepare("SELECT data FROM sync_state WHERE key = ?").bind(key).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as T) : null;
}

export async function setState(env: Env, key: string, data: unknown): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO sync_state (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  )
    .bind(key, JSON.stringify(data), now())
    .run();
}

export async function clearState(env: Env, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sync_state WHERE key = ?").bind(key).run();
}

/** YouTube quota resets at midnight Pacific time. */
export function quotaDay(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(at);
}

export async function quotaUsedToday(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT units FROM quota_usage WHERE day = ?").bind(quotaDay()).first<{ units: number }>();
  return row?.units ?? 0;
}

export async function addQuota(env: Env, units: number): Promise<void> {
  await env.DB.prepare("INSERT INTO quota_usage (day, units) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET units = units + excluded.units")
    .bind(quotaDay(), units)
    .run();
}
