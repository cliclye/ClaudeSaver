const upstream = process.env.ANTHROPIC_UPSTREAM_URL ?? "https://api.anthropic.com";

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8766),
  upstreamUrl: upstream.replace(/\/$/, ""),
  /** If set, outgoing requests use this key instead of the client's x-api-key */
  fixedApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  redisUrl: process.env.REDIS_URL?.trim() || undefined,
  cheapModel: process.env.CHEAP_MODEL ?? "claude-3-5-haiku-20241022",
  smartModel: process.env.SMART_MODEL ?? "claude-sonnet-4-20250514",
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 86400),
  cacheMaxEntries: Number(process.env.CACHE_MAX_ENTRIES ?? 5000),
};
