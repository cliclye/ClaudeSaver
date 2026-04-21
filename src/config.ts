function parseBool(v: string | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  const s = v.trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off" || s === "") return false;
  return fallback;
}

function parseInt(v: string | undefined, fallback: number): number {
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const upstream = (process.env.ANTHROPIC_UPSTREAM_URL ?? "https://api.anthropic.com").trim();

export const config = {
  host: process.env.HOST?.trim() || "127.0.0.1",
  port: parseInt(process.env.PORT, 8766),
  upstreamUrl: upstream.replace(/\/$/, ""),
  /** If set, outgoing requests use this key instead of the client's x-api-key */
  fixedApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  redisUrl: process.env.REDIS_URL?.trim() || undefined,
  /** Haiku 4.5 — default for small / simple requests */
  cheapModel: process.env.CHEAP_MODEL?.trim() || "claude-haiku-4-5-20251001",
  /** Sonnet 4.6 — default for medium "complex" requests */
  smartModel: process.env.SMART_MODEL?.trim() || "claude-sonnet-4-6",
  /** Opus 4.7 — default for largest / heaviest routed requests */
  premiumModel: process.env.PREMIUM_MODEL?.trim() || "claude-opus-4-7",
  cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 86400),
  cacheMaxEntries: parseInt(process.env.CACHE_MAX_ENTRIES, 5000),
  /**
   * When true, do not rewrite `model` (subscription / OAuth users often match on allowed catalog).
   */
  skipModelRouting: parseBool(process.env.CLAUDE_SAVER_SKIP_MODEL_ROUTING, false),
  /**
   * Prompt compression silently rewrites phrases like "please explain" → "EXPLAIN" in user
   * messages. That can surprise users, so it is **opt-in**: set `CLAUDE_SAVER_ENABLE_COMPRESSION=1`.
   */
  enableCompression: parseBool(process.env.CLAUDE_SAVER_ENABLE_COMPRESSION, false),
};
