import { fromB64, toB64 } from "./crypto";

export function encodeVec(v: ArrayLike<number>): string {
  const f = Float32Array.from(v);
  return toB64(new Uint8Array(f.buffer));
}

export function decodeVec(b64: string): Float32Array {
  const bytes = fromB64(b64);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export function normalize(v: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(v);
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i]! * out[i]!;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i]! /= n;
  return out;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i]! * b[i]!;
  return s;
}

export function mean(vectors: Float32Array[]): Float32Array | null {
  const first = vectors[0];
  if (!first) return null;
  const out = new Float32Array(first.length);
  for (const v of vectors) for (let i = 0; i < out.length; i++) out[i]! += v[i]!;
  for (let i = 0; i < out.length; i++) out[i]! /= vectors.length;
  return out;
}

/**
 * A category's prototype blends its description embedding with the centroid of
 * videos the owner confirmed or corrected into it. Examples take over as they accumulate.
 */
export function prototype(description: Float32Array, centroid: Float32Array | null, exampleCount: number): Float32Array {
  if (!centroid || exampleCount === 0) return normalize(description);
  const w = 1 / (1 + exampleCount / 3);
  const d = normalize(description);
  const c = normalize(centroid);
  const out = new Float32Array(d.length);
  for (let i = 0; i < out.length; i++) out[i] = w * d[i]! + (1 - w) * c[i]!;
  return normalize(out);
}

export interface Prototype {
  categoryId: number;
  vec: Float32Array;
}

export interface Prediction {
  categoryId: number;
  confidence: number;
}

/** Softmax over cosine similarities; temperature tuned for bge-style embeddings. */
export function predict(vec: Float32Array, protos: Prototype[], temperature = 0.05): Prediction | null {
  if (protos.length === 0) return null;
  const v = normalize(vec);
  const sims = protos.map((p) => dot(v, p.vec));
  const max = Math.max(...sims);
  const exps = sims.map((s) => Math.exp((s - max) / temperature));
  const total = exps.reduce((a, b) => a + b, 0);
  let best = 0;
  for (let i = 1; i < sims.length; i++) if (sims[i]! > sims[best]!) best = i;
  return { categoryId: protos[best]!.categoryId, confidence: exps[best]! / total };
}

export const REVIEW_THRESHOLD = 0.45;
