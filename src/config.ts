const upstream = process.env.ANTHROPIC_UPSTREAM_URL ?? "https://api.anthropic.com";

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8766),
  upstreamUrl: upstream.replace(/\/$/, ""),
  /** If set, outgoing requests use this key instead of the client's x-api-key */
  fixedApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  redisUrl: process.env.REDIS_URL?.trim() || undefined,
  /** Haiku 4.5 — default for small / simple requests */
  cheapModel: process.env.CHEAP_MODEL ?? "claude-haiku-4-5-20251001",
  /** Sonnet 4.6 — default for medium “complex” requests */
  smartModel: process.env.SMART_MODEL ?? "claude-sonnet-4-6",
  /** Opus 4.7 — default for largest / heaviest routed requests */
  premiumModel: process.env.PREMIUM_MODEL ?? "claude-opus-4-7",
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 86400),
  cacheMaxEntries: Number(process.env.CACHE_MAX_ENTRIES ?? 5000),
  /**
   * When true, do not rewrite `model` (subscription / OAuth users often match on allowed catalog).
   * Prompt compression still runs unless you add a separate flag later.
   */
  skipModelRouting:
    process.env.CLAUDE_SAVER_SKIP_MODEL_ROUTING === "1" ||
    process.env.CLAUDE_SAVER_SKIP_MODEL_ROUTING === "true",
};
