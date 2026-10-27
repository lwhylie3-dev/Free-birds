import { describe, expect, it } from "vitest";
import { parseCategoryJson, videoText } from "../src/classify";
import { decrypt, encrypt, sign, verify } from "../src/crypto";
import { quotaDay } from "../src/db";
import { decodeVec, encodeVec, normalize, predict, prototype } from "../src/vectors";
import { esc } from "../src/ui";
import { parseVideoId } from "../src/youtube";

const SECRET = "x".repeat(48);

describe("parseVideoId", () => {
  const id = "dQw4w9WgXcQ";
  it.each([
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}&t=42s`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://youtube.com/live/${id}`,
    `https://music.youtube.com/watch?v=${id}&list=RD`,
    `Check this out https://youtu.be/${id} lol`,
  ])("extracts from %s", (input) => expect(parseVideoId(input)).toBe(id));

  it.each(["", "hello", "https://example.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/short", "https://www.youtube.com/@channel"])(
    "rejects %s",
    (input) => expect(parseVideoId(input)).toBeNull(),
  );
});

describe("crypto", () => {
  it("round-trips encryption with a fresh IV each time", async () => {
    const a = await encrypt(SECRET, "refresh-token");
    const b = await encrypt(SECRET, "refresh-token");
    expect(a).not.toBe(b);
    expect(await decrypt(SECRET, a)).toBe("refresh-token");
  });

  it("rejects tampered or foreign-key ciphertext", async () => {
    const blob = await encrypt(SECRET, "secret");
    await expect(decrypt("y".repeat(48), blob)).rejects.toThrow();
  });

  it("verifies signatures and rejects tampering", async () => {
    const signed = await sign(SECRET, '{"exp":1}');
    expect(await verify(SECRET, signed)).toBe('{"exp":1}');
    expect(await verify(SECRET, signed.slice(0, -2) + "AA")).toBeNull();
    expect(await verify("y".repeat(48), signed)).toBeNull();
    expect(await verify(SECRET, "garbage")).toBeNull();
    expect(await verify(SECRET, undefined)).toBeNull();
  });

  it("refuses a short secret", async () => {
    await expect(encrypt("short", "x")).rejects.toThrow(/APP_SECRET/);
  });
});

describe("vectors", () => {
  it("encodes and decodes float vectors", () => {
    const v = [0.25, -1.5, 3];
    expect([...decodeVec(encodeVec(v))]).toEqual(v);
  });

  it("predicts the nearest category with a softmax confidence", () => {
    const protos = [
      { categoryId: 1, vec: normalize([1, 0, 0]) },
      { categoryId: 2, vec: normalize([0, 1, 0]) },
    ];
    const p = predict(new Float32Array([0.9, 0.1, 0]), protos)!;
    expect(p.categoryId).toBe(1);
    expect(p.confidence).toBeGreaterThan(0.9);
    expect(predict(new Float32Array([1, 0, 0]), [])).toBeNull();
  });

  it("lets owner examples pull a prototype away from its description", () => {
    const desc = new Float32Array([1, 0]);
    const examples = new Float32Array([0, 1]);
    expect(prototype(desc, null, 0)[1]).toBe(0);
    const few = prototype(desc, examples, 1);
    const many = prototype(desc, examples, 30);
    expect(many[1]!).toBeGreaterThan(few[1]!);
    expect(many[1]!).toBeGreaterThan(many[0]!);
  });
});

describe("parseCategoryJson", () => {
  it("extracts and dedupes categories from chatty model output", () => {
    const out = parseCategoryJson(
      'Sure! Here you go:\n[{"name":"Cooking","description":"Recipes"},{"name":"cooking","description":"dupe"},{"name":"","description":"x"},{"name":"Chess","description":"Openings"}]\nEnjoy',
    );
    expect(out).toEqual([
      { name: "Cooking", description: "Recipes" },
      { name: "Chess", description: "Openings" },
    ]);
  });

  it("returns [] for unusable output", () => {
    expect(parseCategoryJson("no json here")).toEqual([]);
    expect(parseCategoryJson("[not json]")).toEqual([]);
  });
});

describe("misc", () => {
  it("builds embedding text from metadata", () => {
    const t = videoText({ title: "T", channel_title: "C", tags: JSON.stringify(["a", "b"]), description: "D" });
    expect(t).toBe("T\nChannel: C\nTags: a, b\nD");
  });

  it("escapes HTML", () => {
    expect(esc(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });

  it("uses the Pacific-time day for quota", () => {
    // 2026-01-01 05:00 UTC is still Dec 31 in California.
    expect(quotaDay(new Date("2026-01-01T05:00:00Z"))).toBe("2025-12-31");
  });
});
