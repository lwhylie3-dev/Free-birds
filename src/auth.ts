import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { decrypt, encrypt, fromB64Url, randomToken, sha256Hex, sign, timingSafeEqual, toB64Url, verify } from "./crypto";
import { getSetting, log, setSetting } from "./db";
import { now, type Env } from "./env";
import { canWrite, TOKEN_URL, WRITE_SCOPE } from "./youtube";

export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/youtube.readonly"];
const SESSION_COOKIE = "nx_session";
const OAUTH_COOKIE = "nx_oauth";
const SESSION_DAYS = 30;

type C = Context<{ Bindings: Env }>;

export function redirectUri(c: C): string {
  return `${new URL(c.req.url).origin}/auth/callback`;
}

const cookieOpts = { httpOnly: true, secure: true, sameSite: "Lax" as const, path: "/" };

export async function isLoggedIn(c: C): Promise<boolean> {
  const payload = await verify(c.env.APP_SECRET, getCookie(c, SESSION_COOKIE));
  if (!payload) return false;
  const { exp } = JSON.parse(payload) as { exp: number };
  return exp > now();
}

async function startSession(c: C): Promise<void> {
  const exp = now() + SESSION_DAYS * 86_400_000;
  setCookie(c, SESSION_COOKIE, await sign(c.env.APP_SECRET, JSON.stringify({ exp })), { ...cookieOpts, maxAge: SESSION_DAYS * 86_400 });
}

export function logout(c: C): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/**
 * Redirect to Google's consent page (authorization code + PKCE).
 * Playlist-management access is only requested when organizing is being enabled or already was.
 */
export async function beginOAuth(c: C, wantWrite = false): Promise<Response> {
  const scopes = wantWrite || (await canWrite(c.env)) ? [...SCOPES, WRITE_SCOPE] : SCOPES;
  const state = randomToken(16);
  const verifier = randomToken(48);
  const challenge = toB64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  setCookie(c, OAUTH_COOKIE, await sign(c.env.APP_SECRET, JSON.stringify({ state, verifier, exp: now() + 600_000 })), {
    ...cookieOpts,
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(c),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Handle Google's redirect. Only OWNER_EMAIL may connect. Returns an error message or null on success. */
export async function finishOAuth(c: C): Promise<string | null> {
  const raw = await verify(c.env.APP_SECRET, getCookie(c, OAUTH_COOKIE));
  deleteCookie(c, OAUTH_COOKIE, { path: "/" });
  if (!raw) return "Sign-in expired. Please try again.";
  const saved = JSON.parse(raw) as { state: string; verifier: string; exp: number };
  const { code, state, error } = c.req.query();
  if (error) return `Google returned: ${error}`;
  if (!code || !state || saved.exp < now() || !timingSafeEqual(state, saved.state)) return "Sign-in check failed. Please try again.";

  const res = await fetch(c.env.GOOGLE_TOKEN_URL ?? TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(c),
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
  });
  const tok = (await res.json()) as TokenResponse;
  if (!res.ok || !tok.access_token || !tok.id_token) return `Token exchange failed: ${tok.error_description ?? tok.error ?? res.status}`;

  // The id_token came straight from Google's token endpoint over TLS, so its claims can be read directly.
  const claims = JSON.parse(new TextDecoder().decode(fromB64Url(tok.id_token.split(".")[1] ?? ""))) as {
    aud?: string;
    email?: string;
    email_verified?: boolean;
  };
  const owner = (c.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!owner) return "OWNER_EMAIL is not configured on the server.";
  if (claims.aud !== c.env.GOOGLE_CLIENT_ID || !claims.email_verified || claims.email?.toLowerCase() !== owner) {
    await log(c.env, "auth", "warn", `Rejected sign-in from ${claims.email ?? "unknown account"}.`);
    return "This account isn't allowed to use this app.";
  }

  const t = now();
  const accessEnc = await encrypt(c.env.APP_SECRET, tok.access_token);
  const expiresAt = t + (tok.expires_in ?? 3600) * 1000;
  if (tok.refresh_token) {
    await c.env.DB.prepare(
      `INSERT INTO oauth_tokens (id, email, scope, refresh_token_enc, access_token_enc, access_expires_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, scope = excluded.scope, refresh_token_enc = excluded.refresh_token_enc,
         access_token_enc = excluded.access_token_enc, access_expires_at = excluded.access_expires_at, updated_at = excluded.updated_at`,
    )
      .bind(claims.email, tok.scope ?? null, await encrypt(c.env.APP_SECRET, tok.refresh_token), accessEnc, expiresAt, t)
      .run();
  } else {
    const updated = await c.env.DB.prepare("UPDATE oauth_tokens SET scope = ?, access_token_enc = ?, access_expires_at = ?, updated_at = ? WHERE id = 1")
      .bind(tok.scope ?? null, accessEnc, expiresAt, t)
      .run();
    if (!updated.meta.changes) return "Google didn't return a refresh token. Remove the app's access at myaccount.google.com/permissions and try again.";
  }
  await startSession(c);
  const write = (tok.scope ?? "").split(/\s+/).includes(WRITE_SCOPE);
  await log(c.env, "auth", "ok", write ? "YouTube connected with playlist-management access." : "YouTube connected (read-only).");
  return null;
}

/** Revoke at Google and delete stored tokens. */
export async function disconnect(env: Env): Promise<void> {
  const row = await env.DB.prepare("SELECT refresh_token_enc FROM oauth_tokens WHERE id = 1").first<{ refresh_token_enc: string }>();
  if (row) {
    try {
      const token = await decrypt(env.APP_SECRET, row.refresh_token_enc);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
    } catch {
      // Deleting locally still disconnects the app even if Google can't be reached.
    }
  }
  await env.DB.prepare("DELETE FROM oauth_tokens").run();
  await log(env, "auth", "info", "YouTube disconnected and token revoked.");
}

/** Bearer-token check for the iOS Shortcut. Only the SHA-256 hash is stored. */
export async function checkShortcutToken(env: Env, header: string | undefined): Promise<boolean> {
  const token = header?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const stored = await getSetting(env, "shortcut_token_hash");
  return stored !== null && timingSafeEqual(await sha256Hex(token), stored);
}

export async function rotateShortcutToken(env: Env): Promise<string> {
  const token = randomToken(32);
  await setSetting(env, "shortcut_token_hash", await sha256Hex(token));
  await log(env, "auth", "info", "New Shortcut token created; the old one stopped working.");
  return token;
}
