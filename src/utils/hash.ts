import { createHash } from "node:crypto";

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Rough normalization for cache keys — not a full parser */
export function normalizeForCache(s: string): string {
  return s
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, "")
    .trim();
}
