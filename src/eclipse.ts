// Eclipse: one registry, event log, command queue and heads-up feed for every external system:
// the smart desk, Even G2 glasses, the R1 ring (through the glasses), and any other wearable.
// Devices authenticate with their own revocable bearer token; only its SHA-256 hash is stored.

import { Hono, type Context } from "hono";
import { randomToken, sha256Hex } from "./crypto";
import { getSetting, log } from "./db";
import { now, type Env } from "./env";

type App = { Bindings: Env; Variables: { device: Device } };

export const DEVICE_KINDS = ["desk", "glasses", "ring", "watch", "phone", "sensor", "other"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export interface Device {
  id: string;
  kind: DeviceKind;
  name: string;
  vendor: string;
  model: string;
  parent_id: string | null;
  capabilities: string;
  status: "active" | "revoked";
  last_seen_at: number | null;
  created_at: number;
}

export interface HudItem {
  id: number;
  text: string;
  priority: number;
  created_at: number;
}

/** Commands a device may receive. Anything else is rejected at the queue. */
export const COMMANDS = ["focus.toggle", "focus.set", "charge.seek", "stand.nudge", "oled.show", "ping"] as const;

/** Semantic actions the glasses (or any HUD client) may request. */
export const ACTIONS = ["hud.ack", "desk.focus", "desk.charge", "desk.stand", "ping"] as const;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_BODY = 16 * 1024;

export function isDeviceId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(id);
}

/** Shallow merge, where null deletes a key. Keeps the state blob flat and small. */
export function mergeState(prev: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** Minutes the owner has been seated at a desk, or null if not seated. */
export function seatedMinutes(state: Record<string, unknown>, at = now()): number | null {
  const since = typeof state.seated_since === "number" ? state.seated_since : null;
  return since === null ? null : Math.max(0, Math.floor((at - since) / MINUTE));
}

/**
 * The text block for a 576x288 G2 lens: one firmware font, ~40 chars a line, ~9 lines.
 * Status line first, then the current HUD item with its position, then a hint row.
 */
export function composeGlance(input: {
  time: string;
  desk?: Record<string, unknown> | null;
  items: HudItem[];
  index: number;
  review: number;
}): string {
  const parts: string[] = [];
  const status = [input.time];
  if (input.desk) {
    const sat = seatedMinutes(input.desk);
    if (sat !== null) status.push(`seated ${sat}m`);
    if (typeof input.desk.charge === "string" && input.desk.charge !== "idle") status.push(`phone ${input.desk.charge}`);
    if (input.desk.focus === true) status.push("FOCUS");
  }
  if (input.review > 0) status.push(`${input.review} to review`);
  parts.push(status.join("  |  "));
  parts.push("");
  if (input.items.length === 0) {
    parts.push("All clear.");
  } else {
    const i = Math.min(Math.max(input.index, 0), input.items.length - 1);
    const item = input.items[i]!;
    parts.push(`${item.priority >= 2 ? "!! " : ""}${item.text}`.slice(0, 300));
    parts.push("");
    parts.push(`${i + 1}/${input.items.length}  tap: done  swipe: next`);
  }
  return parts.join("\n");
}

async function deviceFromToken(env: Env, header: string | undefined): Promise<Device | null> {
  const token = header?.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length < 20) return null;
  return env.DB.prepare("SELECT * FROM devices WHERE token_hash = ? AND status = 'active'").bind(await sha256Hex(token)).first<Device>();
}

export async function getDeviceState(env: Env, id: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare("SELECT data FROM device_state WHERE device_id = ?").bind(id).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Record<string, unknown>) : {};
}

async function patchDeviceState(env: Env, id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const next = mergeState(await getDeviceState(env, id), patch);
  await env.DB.prepare(
    "INSERT INTO device_state (device_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  )
    .bind(id, JSON.stringify(next).slice(0, 8000), now())
    .run();
  return next;
}

export async function queueCommand(env: Env, deviceId: string, command: string, args: Record<string, unknown> = {}): Promise<void> {
  if (!(COMMANDS as readonly string[]).includes(command)) throw new Error(`Unknown command ${command}`);
  await env.DB.prepare("INSERT INTO device_commands (device_id, command, args, created_at) VALUES (?, ?, ?, ?)")
    .bind(deviceId, command, JSON.stringify(args), now())
    .run();
}

async function queueForKind(env: Env, kind: DeviceKind, command: string, args: Record<string, unknown> = {}): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id FROM devices WHERE kind = ? AND status = 'active' AND token_hash IS NOT NULL").bind(kind).all<{ id: string }>();
  for (const d of results) await queueCommand(env, d.id, command, args);
  return results.length;
}

export async function postHud(
  env: Env,
  text: string,
  opts: { target?: "all" | "glasses" | "desk"; priority?: number; source?: string; dedupeKey?: string; ttlMs?: number } = {},
): Promise<boolean> {
  const t = now();
  const r = await env.DB.prepare(
    "INSERT OR IGNORE INTO hud_messages (target, text, priority, source, dedupe_key, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(opts.target ?? "all", text.slice(0, 300), opts.priority ?? 1, opts.source ?? "owner", opts.dedupeKey ?? null, t, opts.ttlMs ? t + opts.ttlMs : null)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function openHud(env: Env, target: "glasses" | "desk" | "all"): Promise<HudItem[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, text, priority, created_at FROM hud_messages
     WHERE acked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND (target = 'all' OR target = ? OR ? = 'all')
     ORDER BY priority DESC, id DESC LIMIT 20`,
  )
    .bind(now(), target, target)
    .all<HudItem>();
  return results;
}

async function sitLimitMinutes(env: Env): Promise<number> {
  const v = Number(await getSetting(env, "eclipse_sit_minutes"));
  return Number.isFinite(v) && v >= 10 ? v : 50;
}

/** Stand-up reminder: once per sitting, on the lenses and as a nudge on the desk. */
async function checkSitting(env: Env, desk: Device, state: Record<string, unknown>): Promise<void> {
  const sat = seatedMinutes(state);
  if (sat === null || sat < (await sitLimitMinutes(env))) return;
  const fresh = await postHud(env, `Seated ${sat} min. Stand, stretch, drink water.`, {
    priority: 2,
    source: "rule:sit",
    dedupeKey: `stand:${desk.id}:${state.seated_since}`,
    ttlMs: 30 * MINUTE,
  });
  if (fresh) await queueCommand(env, desk.id, "stand.nudge", { minutes: sat });
}

/** Apply an event's side effects. Pure bookkeeping lives in the helpers above. */
async function applyEvent(env: Env, device: Device, type: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const t = now();
  let state: Record<string, unknown> | null = null;

  if (type === "state" || type === "heartbeat") {
    const patch = type === "state" ? payload : {};
    state = await patchDeviceState(env, device.id, patch);
  } else if (type === "presence") {
    const prev = await getDeviceState(env, device.id);
    const seated = payload.seated === true;
    if (!seated && prev.seated_since) {
      // Standing up resolves this sitting's reminder.
      await env.DB.prepare("UPDATE hud_messages SET acked_at = ? WHERE dedupe_key = ? AND acked_at IS NULL")
        .bind(t, `stand:${device.id}:${prev.seated_since}`)
        .run();
    }
    state = await patchDeviceState(env, device.id, { seated, seated_since: seated ? (prev.seated_since ?? t) : null });
  } else if (type === "charge") {
    const charge = typeof payload.state === "string" ? payload.state : "idle";
    state = await patchDeviceState(env, device.id, { charge, charge_battery: payload.battery ?? null });
    if (charge === "full") await postHud(env, `${String(payload.device ?? "Phone")} is fully charged.`, { priority: 0, source: "rule:charge", ttlMs: 15 * MINUTE });
  } else if (type === "gesture") {
    // Ring gestures arrive through the glasses app; keep the ring's last-seen fresh.
    if (payload.source === "ring") {
      await env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE kind = 'ring' AND (parent_id = ? OR parent_id IS NULL)").bind(t, device.id).run();
    }
  } else if (type === "action") {
    const action = String(payload.action ?? "");
    if (!(ACTIONS as readonly string[]).includes(action)) throw new BadRequest(`Unknown action ${action}`);
    if (action === "hud.ack") {
      await env.DB.prepare("UPDATE hud_messages SET acked_at = ? WHERE id = ? AND acked_at IS NULL").bind(t, Number(payload.id)).run();
    } else if (action === "desk.focus") await queueForKind(env, "desk", "focus.toggle");
    else if (action === "desk.charge") await queueForKind(env, "desk", "charge.seek");
    else if (action === "desk.stand") await queueForKind(env, "desk", "stand.nudge", { manual: true });
  }

  if (device.kind === "desk") await checkSitting(env, device, state ?? (await getDeviceState(env, device.id)));
  return state ?? {};
}

class BadRequest extends Error {}

async function libraryGlance(env: Env): Promise<{ review: number; latest: string | null }> {
  const review = await env.DB.prepare("SELECT COUNT(*) n FROM classifications WHERE needs_review = 1").first<{ n: number }>();
  const latest = await env.DB.prepare(
    "SELECT v.title FROM video_sources s JOIN videos v ON v.id = s.video_id WHERE s.source = 'submitted' ORDER BY s.seen_at DESC LIMIT 1",
  ).first<{ title: string }>();
  return { review: review?.n ?? 0, latest: latest?.title ?? null };
}

async function primaryDeskState(env: Env): Promise<Record<string, unknown> | null> {
  const row = await env.DB.prepare(
    "SELECT s.data FROM device_state s JOIN devices d ON d.id = s.device_id WHERE d.kind = 'desk' AND d.status = 'active' ORDER BY s.updated_at DESC LIMIT 1",
  ).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Record<string, unknown>) : null;
}

/** Cron housekeeping: prune old rows and re-check sitting desks (catches a desk that stopped reporting). */
export async function eclipseTick(env: Env): Promise<void> {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM device_events WHERE ts < ?").bind(t - 30 * DAY),
    env.DB.prepare("DELETE FROM device_commands WHERE status = 'delivered' AND delivered_at < ?").bind(t - 7 * DAY),
    env.DB.prepare("DELETE FROM device_commands WHERE status = 'pending' AND created_at < ?").bind(t - DAY),
    env.DB.prepare("DELETE FROM hud_messages WHERE (acked_at IS NOT NULL AND acked_at < ?) OR (expires_at IS NOT NULL AND expires_at < ?)").bind(t - 7 * DAY, t - DAY),
  ]);
  const { results } = await env.DB.prepare("SELECT * FROM devices WHERE kind = 'desk' AND status = 'active'").all<Device>();
  for (const desk of results) {
    // A desk silent for 15 minutes is treated as empty, so a crashed agent can't nag forever.
    if (!desk.last_seen_at || t - desk.last_seen_at > 15 * MINUTE) continue;
    await checkSitting(env, desk, await getDeviceState(env, desk.id));
  }
}

// ---------- Owner-side registry operations (used by the /eclipse pages) ----------

export async function registerDevice(
  env: Env,
  input: { id: string; kind: string; name: string; vendor?: string; model?: string; parentId?: string | null; capabilities?: string[]; withToken: boolean },
): Promise<string | null> {
  if (!isDeviceId(input.id)) throw new BadRequest("Device ID: lowercase letters, digits and dashes, up to 32 characters.");
  if (!(DEVICE_KINDS as readonly string[]).includes(input.kind)) throw new BadRequest("Unknown device kind.");
  const token = input.withToken ? randomToken() : null;
  await env.DB.prepare(
    "INSERT INTO devices (id, kind, name, vendor, model, parent_id, capabilities, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      input.id,
      input.kind,
      input.name.slice(0, 60) || input.id,
      (input.vendor ?? "").slice(0, 60),
      (input.model ?? "").slice(0, 60),
      input.parentId || null,
      JSON.stringify(input.capabilities ?? []),
      token ? await sha256Hex(token) : null,
      now(),
    )
    .run();
  await log(env, "eclipse", "ok", `Registered ${input.kind} "${input.id}".`);
  return token;
}

export async function rotateDeviceToken(env: Env, id: string): Promise<string> {
  const token = randomToken();
  await env.DB.prepare("UPDATE devices SET token_hash = ?, status = 'active' WHERE id = ?").bind(await sha256Hex(token), id).run();
  await log(env, "eclipse", "ok", `New token for "${id}"; the old one stopped working.`);
  return token;
}

export async function revokeDevice(env: Env, id: string): Promise<void> {
  await env.DB.prepare("UPDATE devices SET status = 'revoked', token_hash = NULL WHERE id = ?").bind(id).run();
  await log(env, "eclipse", "warn", `Revoked "${id}".`);
}

export { BadRequest as EclipseBadRequest };

// ---------- Device API: /eclipse/v1 ----------

export const eclipseApi = new Hono<App>();

// The G2 app runs in the Even App's WebView, so the API must answer CORS. Auth is a bearer header, never a cookie.
eclipseApi.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "86400",
    });
  }
  await next();
  c.header("access-control-allow-origin", "*");
  c.header("cache-control", "no-store");
});

eclipseApi.use("*", async (c, next) => {
  const device = await deviceFromToken(c.env, c.req.header("authorization"));
  if (!device) return c.json({ ok: false, message: "Invalid or missing device token." }, 401);
  c.set("device", device);
  await c.env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(now(), device.id).run();
  return next();
});

async function readJson(c: Context<App>): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (text.length > MAX_BODY) throw new BadRequest("Body too large.");
  if (!text) return {};
  const v = JSON.parse(text) as unknown;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new BadRequest("Body must be a JSON object.");
  return v as Record<string, unknown>;
}

eclipseApi.onError((err, c) => {
  if (err instanceof BadRequest || err instanceof SyntaxError) return c.json({ ok: false, message: err.message }, 400);
  return c.json({ ok: false, message: "Server error." }, 500);
});

eclipseApi.get("/me", async (c) => {
  const d = c.get("device");
  return c.json({ ok: true, device: { id: d.id, kind: d.kind, name: d.name }, state: await getDeviceState(c.env, d.id) });
});

/** Body: { type, payload } or { events: [{ type, payload }, ...] } (max 50). */
eclipseApi.post("/events", async (c) => {
  const device = c.get("device");
  const body = await readJson(c);
  const list = Array.isArray(body.events) ? (body.events as unknown[]).slice(0, 50) : [body];
  let state: Record<string, unknown> = {};
  for (const raw of list) {
    const e = (raw ?? {}) as { type?: unknown; payload?: unknown };
    const type = String(e.type ?? "");
    if (!/^[a-z][a-z0-9_.]{0,31}$/.test(type)) throw new BadRequest("Event type: lowercase, up to 32 characters.");
    const payload = e.payload && typeof e.payload === "object" && !Array.isArray(e.payload) ? (e.payload as Record<string, unknown>) : {};
    if (type !== "heartbeat") {
      await c.env.DB.prepare("INSERT INTO device_events (device_id, type, payload, ts) VALUES (?, ?, ?, ?)")
        .bind(device.id, type, JSON.stringify(payload).slice(0, 4000), now())
        .run();
    }
    state = await applyEvent(c.env, device, type, payload);
  }
  return c.json({ ok: true, state });
});

/** Pending commands for the calling device; marks them delivered. */
eclipseApi.get("/commands", async (c) => {
  const device = c.get("device");
  const { results } = await c.env.DB.prepare(
    "SELECT id, command, args, created_at FROM device_commands WHERE device_id = ? AND status = 'pending' ORDER BY id LIMIT 20",
  )
    .bind(device.id)
    .all<{ id: number; command: string; args: string; created_at: number }>();
  if (results.length) {
    await c.env.DB.prepare(`UPDATE device_commands SET status = 'delivered', delivered_at = ? WHERE id IN (${results.map(() => "?").join(",")})`)
      .bind(now(), ...results.map((r) => r.id))
      .run();
  }
  return c.json({ ok: true, commands: results.map((r) => ({ id: r.id, command: r.command, args: JSON.parse(r.args), created_at: r.created_at })) });
});

/** Heads-up feed. Glasses get a ready-to-render glance; the desk gets the same items for its clear OLED. */
eclipseApi.get("/hud", async (c) => {
  const device = c.get("device");
  const target = device.kind === "desk" ? "desk" : "glasses";
  const tz = c.req.query("tz") || (await getSetting(c.env, "eclipse_tz")) || "America/New_York";
  let time: string;
  try {
    time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date());
  } catch {
    time = new Date().toISOString().slice(11, 16) + " UTC";
  }
  const [items, desk, library] = await Promise.all([openHud(c.env, target), primaryDeskState(c.env), libraryGlance(c.env)]);
  const index = Number(c.req.query("i") ?? 0) || 0;
  return c.json({
    ok: true,
    time,
    items,
    desk,
    library,
    glance: composeGlance({ time, desk, items, index, review: library.review }),
  });
});
