import { config as loadEnv } from "dotenv";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Project-root `.env` (works even if `cwd` is not the repo root). */
loadEnv({ path: join(__dirname, "..", ".env") });

/**
 * Build fingerprint exposed on `/health`. Lets `npm run claude` detect a stale background
 * proxy started before a code change and recycle it automatically.
 */
function buildFingerprint(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    const v = typeof pkg.version === "string" ? pkg.version : "0.0.0";
    const here = __dirname;
    let mtime = 0;
    for (const f of ["index.js", "upstream.js", "config.js"]) {
      try {
        const m = statSync(join(here, f)).mtimeMs;
        if (m > mtime) mtime = m;
      } catch {
        // file not present (running via tsx); fall through
      }
    }
    if (mtime === 0) {
      try {
        mtime = statSync(join(here, "..", "src", "index.ts")).mtimeMs;
      } catch {
        mtime = Date.now();
      }
    }
    return `${v}+${Math.round(mtime)}`;
  } catch {
    return "0.0.0+0";
  }
}
const BUILD = buildFingerprint();
import { config } from "./config.js";
import { cacheKeyForMessages, getCache, shouldCache } from "./core/cache.js";
import { optimizeMessagesRequest } from "./core/optimizer.js";
import {
  recordCacheHit,
  recordRequest,
  recordRoutingSavings,
  resetStats,
  snapshot as statsSnapshot,
} from "./core/stats.js";
import { forwardUpstream, webResponseToNodeStream } from "./upstream.js";
import { renderDashboard } from "./dashboard.js";
import { sha256Hex } from "./utils/hash.js";

/**
 * Isolate cache entries per caller. API-key users use `x-api-key`; Pro/Max/Team OAuth uses
 * `Authorization: Bearer …` (and often `X-Claude-Code-Session-Id` — forwarded to upstream as well).
 */
function cacheIdentityFingerprint(req: import("fastify").FastifyRequest): string {
  if (config.fixedApiKey && !usesBearerAuth(req)) return sha256Hex(config.fixedApiKey).slice(0, 16);

  const apiKey =
    typeof req.headers["x-api-key"] === "string"
      ? req.headers["x-api-key"]
      : Array.isArray(req.headers["x-api-key"])
        ? req.headers["x-api-key"][0]
        : "";
  if (apiKey) return sha256Hex(apiKey).slice(0, 16);

  const auth =
    typeof req.headers["authorization"] === "string"
      ? req.headers["authorization"]
      : Array.isArray(req.headers["authorization"])
        ? req.headers["authorization"][0]
        : "";
  if (auth) return sha256Hex(auth).slice(0, 16);

  const session =
    typeof req.headers["x-claude-code-session-id"] === "string"
      ? req.headers["x-claude-code-session-id"]
      : Array.isArray(req.headers["x-claude-code-session-id"])
        ? req.headers["x-claude-code-session-id"][0]
        : "";
  if (session) return sha256Hex(session).slice(0, 16);

  return "anon";
}

function usesBearerAuth(req: import("fastify").FastifyRequest): boolean {
  const raw =
    typeof req.headers["authorization"] === "string"
      ? req.headers["authorization"]
      : Array.isArray(req.headers["authorization"])
        ? req.headers["authorization"][0]
        : "";
  return typeof raw === "string" && raw.trim().toLowerCase().startsWith("bearer ");
}

const hopResponse = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  // undici decompresses the body before we see it, so the original content-encoding /
  // content-length describe the compressed bytes and would mislead Claude Code.
  "content-encoding",
  "content-length",
]);

function flattenResponseHeaders(res: Response): Record<string, string | string[]> {
  const o: Record<string, string | string[]> = {};
  res.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (hopResponse.has(lower)) return;
    o[key] = value;
  });
  return o;
}

/** Best-effort JSON parse from the raw request body buffer. Returns null on error or non-object. */
function bodyAsJsonObject(req: import("fastify").FastifyRequest): Record<string, unknown> | null {
  const buf = req.body;
  if (!buf) return null;
  let text: string;
  if (Buffer.isBuffer(buf)) text = buf.toString("utf8");
  else if (typeof buf === "string") text = buf;
  else if (typeof buf === "object") return buf as Record<string, unknown>;
  else return null;
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
  } catch {
    // fall through
  }
  return null;
}

/** Raw bytes of the request body (after our raw-buffer parser). Forwarded as-is. */
function bodyAsRaw(req: import("fastify").FastifyRequest): string | undefined {
  const buf = req.body;
  if (buf === undefined || buf === null) return undefined;
  if (Buffer.isBuffer(buf)) return buf.toString("utf8");
  if (typeof buf === "string") return buf;
  return JSON.stringify(buf);
}

async function handleV1Messages(req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
  const raw = bodyAsJsonObject(req);
  if (!raw) {
    return reply.code(400).send({ error: "Expected JSON object body" });
  }

  const optimized = optimizeMessagesRequest(raw);
  const body = optimized.body;
  const { originalModel, chosenModel } = optimized;

  const fingerprint = cacheIdentityFingerprint(req);
  const cache = getCache();
  const cacheable = shouldCache(body);
  const key = cacheKeyForMessages(body, fingerprint);

  recordRequest();
  if (cacheable) {
    const hit = await cache.get(key);
    if (hit) {
      reply.header("x-claude-saver-cache", "HIT");
      try {
        recordCacheHit(hit, originalModel || chosenModel);
      } catch {
        // never let stats accounting break a request
      }
      return reply.code(200).header("content-type", "application/json").send(JSON.parse(hit));
    }
  }

  const serialized = JSON.stringify(body);
  const upstream = await forwardUpstream(req, req.url, serialized);

  if (upstream.body && upstream.headers.get("content-type")?.includes("text/event-stream")) {
    reply.header("x-claude-saver-cache", "BYPASS-STREAM");
    const h = flattenResponseHeaders(upstream);
    for (const [k, v] of Object.entries(h)) reply.header(k, v);
    reply.code(upstream.status);
    const nodeStream = webResponseToNodeStream(upstream);
    if (!nodeStream) return reply.send();
    return reply.send(nodeStream);
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    reply.header("x-claude-saver-cache", "ERROR");
    const h = flattenResponseHeaders(upstream);
    for (const [k, v] of Object.entries(h)) reply.header(k, v);
    return reply.code(upstream.status).send(text);
  }

  if (cacheable) {
    await cache.set(key, text, config.cacheTtlSeconds);
    reply.header("x-claude-saver-cache", "MISS-STORED");
  } else {
    reply.header("x-claude-saver-cache", "SKIP");
  }

  const h = flattenResponseHeaders(upstream);
  for (const [k, v] of Object.entries(h)) reply.header(k, v);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return reply.code(upstream.status).send(text);
  }
  try {
    if (originalModel && chosenModel && originalModel !== chosenModel) {
      recordRoutingSavings(originalModel, chosenModel, payload);
    }
  } catch {
    // never let stats accounting break a request
  }
  return reply.code(upstream.status).send(payload);
}

async function passthrough(req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
  const method = req.method;
  const serialized = method !== "GET" && method !== "HEAD" ? bodyAsRaw(req) : undefined;

  const upstream = await forwardUpstream(req, req.url, serialized);

  const h = flattenResponseHeaders(upstream);
  for (const [k, v] of Object.entries(h)) reply.header(k, v);
  reply.code(upstream.status);

  if (!upstream.body) return reply.send();

  const ct = upstream.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const text = await upstream.text();
    try {
      return reply.send(JSON.parse(text));
    } catch {
      return reply.send(text);
    }
  }

  const nodeStream = webResponseToNodeStream(upstream);
  if (!nodeStream) return reply.send();
  return reply.send(nodeStream);
}

async function main() {
  const app = Fastify({
    logger: true,
    bodyLimit: 104_857_600,
  });

  // Replace the default JSON content-type parser with a permissive raw-buffer parser.
  // Fastify's default parser strictly validates `Content-Length` and rejects requests with
  // mismatched / chunked bodies (FST_ERR_CTP_INVALID_CONTENT_LENGTH). Some clients send
  // `Transfer-Encoding: chunked` or otherwise mismatched lengths, so we just buffer whatever
  // bytes arrive and let the handler decide what to do with them.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", function (_req, payload, done) {
    const chunks: Buffer[] = [];
    payload.on("data", (c: Buffer) => chunks.push(c));
    payload.on("end", () => done(null, Buffer.concat(chunks)));
    payload.on("error", (err: Error) => done(err));
  });

  app.get("/health", async () => ({ ok: true, service: "claude-saver", build: BUILD }));

  app.get("/stats", async () => statsSnapshot());

  app.post("/stats/reset", async () => {
    resetStats();
    return statsSnapshot();
  });

  app.get("/", async (_req, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return renderDashboard({ origin: `http://${config.host}:${config.port}`, build: BUILD });
  });

  app.all("/v1/messages", async (req, reply) => {
    if (req.method !== "POST") return passthrough(req, reply);
    return handleV1Messages(req, reply);
  });

  app.all("/v1/*", async (req, reply) => passthrough(req, reply));

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "EADDRINUSE") {
      console.error(
        `\nPort ${config.port} is already in use on ${config.host}.\n` +
          `Either stop the other process or set PORT=<free port> in .env (and match it in ANTHROPIC_BASE_URL).\n`,
      );
      process.exit(1);
    }
    throw err;
  }

  const origin = `http://${config.host}:${config.port}`;
  app.log.info(
    `Claude Saver listening on ${origin} — set ANTHROPIC_BASE_URL=${origin} for Claude Code`,
  );
  console.log(
    [
      "",
      "  Claude Saver is ready.",
      "",
      `    Dashboard:     ${origin}`,
      `    Claude Code:   ANTHROPIC_BASE_URL=${origin}      (or: npm run claude)`,
      `    Stats / API:   ${origin}/stats   ${origin}/health`,
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
