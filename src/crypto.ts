// AES-GCM for tokens at rest, HMAC for cookies. Both keys derive from APP_SECRET via HKDF.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return fromB64(b64 + "===".slice((b64.length + 3) % 4));
}

interface Keys {
  aes: CryptoKey;
  hmac: CryptoKey;
}

const keyCache = new Map<string, Promise<Keys>>();

function getKeys(secret: string): Promise<Keys> {
  if (!secret || secret.length < 32) throw new Error("APP_SECRET is missing or too short");
  let keys = keyCache.get(secret);
  if (!keys) {
    keys = deriveKeys(secret);
    keyCache.set(secret, keys);
  }
  return keys;
}

async function deriveKeys(secret: string): Promise<Keys> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  const hkdf = (info: string) => ({ name: "HKDF", hash: "SHA-256", salt: enc.encode("noxara-yt"), info: enc.encode(info) });
  const aes = await crypto.subtle.deriveKey(hkdf("aes-gcm"), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const hmac = await crypto.subtle.deriveKey(hkdf("hmac"), base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"]);
  return { aes, hmac };
}

export async function encrypt(secret: string, plaintext: string): Promise<string> {
  const { aes } = await getKeys(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode(plaintext)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function decrypt(secret: string, blob: string): Promise<string> {
  const { aes } = await getKeys(secret);
  const raw = fromB64(blob);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, aes, raw.slice(12));
  return dec.decode(pt);
}

/** Returns `payload.signature`, both base64url. */
export async function sign(secret: string, payload: string): Promise<string> {
  const { hmac } = await getKeys(secret);
  const body = toB64Url(enc.encode(payload));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmac, enc.encode(body)));
  return `${body}.${toB64Url(sig)}`;
}

/** Returns the payload if the signature is valid, else null. */
export async function verify(secret: string, signed: string | undefined): Promise<string | null> {
  if (!signed) return null;
  const dot = signed.indexOf(".");
  if (dot < 1) return null;
  const body = signed.slice(0, dot);
  try {
    const { hmac } = await getKeys(secret);
    const ok = await crypto.subtle.verify("HMAC", hmac, fromB64Url(signed.slice(dot + 1)), enc.encode(body));
    return ok ? dec.decode(fromB64Url(body)) : null;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
