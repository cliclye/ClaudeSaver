import { Redis } from "ioredis";
import { config } from "../config.js";
import { sha256Hex, normalizeForCache } from "../utils/hash.js";

export interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

class MemoryLru implements CacheBackend {
  private readonly map = new Map<string, { value: string; at: number }>();

  constructor(private readonly max: number) {}

  async get(key: string): Promise<string | null> {
    const e = this.map.get(key);
    if (!e) return null;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  async set(key: string, value: string, _ttlSeconds: number): Promise<void> {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, at: Date.now() });
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value;
      if (first) this.map.delete(first);
    }
  }
}

class RedisCache implements CacheBackend {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    const v = await this.redis.get(key);
    return v;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.setex(key, ttlSeconds, value);
  }
}

let singleton: CacheBackend | null = null;

export function getCache(): CacheBackend {
  if (singleton) return singleton;
  if (config.redisUrl) {
    const r = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
    singleton = new RedisCache(r);
  } else {
    singleton = new MemoryLru(config.cacheMaxEntries);
  }
  return singleton;
}

export function cacheKeyForMessages(body: Record<string, unknown>, apiKeyFingerprint: string): string {
  const stream = body.stream === true;
  const model = typeof body.model === "string" ? body.model : "";
  const raw = JSON.stringify(body.messages ?? []);
  const norm = normalizeForCache(raw);
  const h = sha256Hex(`${apiKeyFingerprint}|${stream}|${model}|${norm}`);
  return `cs:${h}`;
}

export function shouldCache(body: Record<string, unknown>): boolean {
  if (body.stream === true) return false;
  return true;
}
