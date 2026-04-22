import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Per-million-token USD prices. These are conservative defaults — override via
 * `PRICE_TABLE_JSON` env var (a JSON object) when Anthropic prices change.
 *
 *   PRICE_TABLE_JSON='{"claude-haiku-4-5":{"in":1,"out":5}}'
 *
 * Keys are matched by `startsWith` against the model id, longest-prefix wins.
 */
const DEFAULT_PRICES: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-sonnet-4": { in: 3, out: 15 },
  "claude-opus-4-7": { in: 15, out: 75 },
  "claude-opus-4": { in: 15, out: 75 },
  "claude-haiku": { in: 1, out: 5 },
  "claude-sonnet": { in: 3, out: 15 },
  "claude-opus": { in: 15, out: 75 },
};

function loadPriceOverrides(): Record<string, { in: number; out: number }> {
  const raw = process.env.PRICE_TABLE_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const out: Record<string, { in: number; out: number }> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (
        v &&
        typeof v === "object" &&
        typeof (v as { in?: unknown }).in === "number" &&
        typeof (v as { out?: unknown }).out === "number"
      ) {
        out[k] = { in: (v as { in: number }).in, out: (v as { out: number }).out };
      }
    }
    return out;
  } catch {
    return {};
  }
}

const PRICES: Record<string, { in: number; out: number }> = {
  ...DEFAULT_PRICES,
  ...loadPriceOverrides(),
};

export function priceFor(model: string): { in: number; out: number } | null {
  if (!model) return null;
  let bestKey = "";
  for (const k of Object.keys(PRICES)) {
    if (model.startsWith(k) && k.length > bestKey.length) bestKey = k;
  }
  return bestKey ? PRICES[bestKey] : null;
}

/** USD cost of a (input,output) pair under a given model. Returns 0 if model is unknown. */
export function costOf(model: string, input: number, output: number): number {
  const p = priceFor(model);
  if (!p) return 0;
  return (input * p.in + output * p.out) / 1_000_000;
}

export interface StatsSnapshot {
  startedAt: number;
  totalRequests: number;
  cacheHits: number;
  cacheTokensSaved: number;
  cacheUsdSaved: number;
  routedRequests: number;
  routingTokensInfluenced: number;
  routingUsdSaved: number;
  totalUsdSaved: number;
  totalTokensSaved: number;
  cacheHitRate: number;
  recent: Array<{
    at: number;
    kind: "cache-hit" | "routed";
    tokens: number;
    usd: number;
    note?: string;
  }>;
}

interface InternalStats {
  startedAt: number;
  totalRequests: number;
  cacheHits: number;
  cacheTokensSaved: number;
  cacheUsdSaved: number;
  routedRequests: number;
  routingTokensInfluenced: number;
  routingUsdSaved: number;
  recent: StatsSnapshot["recent"];
}

const RECENT_MAX = 20;

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_FILE = join(__dirname, "..", "..", ".claude-saver-stats.json");

function emptyStats(): InternalStats {
  return {
    startedAt: Date.now(),
    totalRequests: 0,
    cacheHits: 0,
    cacheTokensSaved: 0,
    cacheUsdSaved: 0,
    routedRequests: 0,
    routingTokensInfluenced: 0,
    routingUsdSaved: 0,
    recent: [],
  };
}

function loadInitial(): InternalStats {
  try {
    const txt = readFileSync(STATS_FILE, "utf8");
    const j = JSON.parse(txt);
    // Back-compat: older format had a `byProvider.anthropic` bucket. Flatten it.
    const src = j.byProvider?.anthropic ?? j;
    const base = emptyStats();
    return {
      startedAt: typeof j.startedAt === "number" ? j.startedAt : base.startedAt,
      totalRequests: Number(j.totalRequests ?? src.requests) || 0,
      cacheHits: Number(src.cacheHits) || 0,
      cacheTokensSaved: Number(src.cacheTokensSaved) || 0,
      cacheUsdSaved: Number(src.cacheUsdSaved) || 0,
      routedRequests: Number(src.routedRequests) || 0,
      routingTokensInfluenced: Number(src.routingTokensInfluenced) || 0,
      routingUsdSaved: Number(src.routingUsdSaved) || 0,
      recent: Array.isArray(j.recent) ? j.recent.slice(-RECENT_MAX) : [],
    };
  } catch {
    return emptyStats();
  }
}

const stats: InternalStats = loadInitial();

function pushRecent(entry: StatsSnapshot["recent"][number]): void {
  stats.recent.push(entry);
  if (stats.recent.length > RECENT_MAX) {
    stats.recent.splice(0, stats.recent.length - RECENT_MAX);
  }
}

let writeTimer: NodeJS.Timeout | null = null;
function persistDebounced() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      mkdirSync(dirname(STATS_FILE), { recursive: true });
      writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    } catch {
      // best-effort; never fail a request because we couldn't persist
    }
  }, 2000);
  if (writeTimer.unref) writeTimer.unref();
}

/**
 * Pull Anthropic `usage` block from a parsed `/v1/messages` response payload:
 *   `{ input_tokens, output_tokens, cache_creation_input_tokens?, cache_read_input_tokens? }`
 */
export function extractUsage(payload: unknown): { input: number; output: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const u = (payload as { usage?: unknown }).usage;
  if (!u || typeof u !== "object") return null;
  const obj = u as Record<string, unknown>;

  const cacheCreate = Number(obj.cache_creation_input_tokens ?? 0) || 0;
  const cacheRead = Number(obj.cache_read_input_tokens ?? 0) || 0;
  const input = (Number(obj.input_tokens ?? 0) || 0) + cacheCreate + cacheRead;
  const output = Number(obj.output_tokens ?? 0) || 0;
  if (input === 0 && output === 0) return null;
  return { input, output };
}

/** Counts every forwarded request (cached or not). */
export function recordRequest(): void {
  stats.totalRequests += 1;
  persistDebounced();
}

/** Cache hit: we avoided a full upstream call. Charge the *original* model that was requested. */
export function recordCacheHit(cachedJson: string, modelHint: string): void {
  let payload: unknown;
  try {
    payload = JSON.parse(cachedJson);
  } catch {
    return;
  }
  const usage = extractUsage(payload);
  if (!usage) return;
  const model =
    modelHint ||
    (typeof (payload as { model?: unknown }).model === "string"
      ? (payload as { model: string }).model
      : "");
  const usd = costOf(model, usage.input, usage.output);
  stats.cacheHits += 1;
  stats.cacheTokensSaved += usage.input + usage.output;
  stats.cacheUsdSaved += usd;
  pushRecent({
    at: Date.now(),
    kind: "cache-hit",
    tokens: usage.input + usage.output,
    usd: round(usd, 4),
    note: model,
  });
  persistDebounced();
}

/**
 * Routing: charged the *chosen* (cheaper) model but the request originally targeted
 * `originalModel`. We didn't save tokens — we paid for them at a lower rate.
 */
export function recordRoutingSavings(
  originalModel: string,
  chosenModel: string,
  payload: unknown,
): void {
  if (!originalModel || !chosenModel || originalModel === chosenModel) return;
  const usage = extractUsage(payload);
  if (!usage) return;
  const originalCost = costOf(originalModel, usage.input, usage.output);
  const actualCost = costOf(chosenModel, usage.input, usage.output);
  const diff = originalCost - actualCost;
  if (diff <= 0) return;
  stats.routedRequests += 1;
  stats.routingTokensInfluenced += usage.input + usage.output;
  stats.routingUsdSaved += diff;
  pushRecent({
    at: Date.now(),
    kind: "routed",
    tokens: usage.input + usage.output,
    usd: round(diff, 4),
    note: `${originalModel} → ${chosenModel}`,
  });
  persistDebounced();
}

export function snapshot(): StatsSnapshot {
  const cacheUsd = stats.cacheUsdSaved;
  const routingUsd = stats.routingUsdSaved;
  return {
    startedAt: stats.startedAt,
    totalRequests: stats.totalRequests,
    cacheHits: stats.cacheHits,
    cacheTokensSaved: stats.cacheTokensSaved,
    cacheUsdSaved: round(cacheUsd, 4),
    routedRequests: stats.routedRequests,
    routingTokensInfluenced: stats.routingTokensInfluenced,
    routingUsdSaved: round(routingUsd, 4),
    totalUsdSaved: round(cacheUsd + routingUsd, 4),
    totalTokensSaved: stats.cacheTokensSaved,
    cacheHitRate: stats.totalRequests > 0 ? stats.cacheHits / stats.totalRequests : 0,
    recent: stats.recent.slice().reverse(),
  };
}

export function resetStats(): void {
  const fresh = emptyStats();
  stats.startedAt = fresh.startedAt;
  stats.totalRequests = 0;
  stats.cacheHits = 0;
  stats.cacheTokensSaved = 0;
  stats.cacheUsdSaved = 0;
  stats.routedRequests = 0;
  stats.routingTokensInfluenced = 0;
  stats.routingUsdSaved = 0;
  stats.recent = [];
  persistDebounced();
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
