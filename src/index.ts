import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";

/** Project-root `.env` (works even if `cwd` is not the repo root). */
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });
import { config } from "./config.js";
import { cacheKeyForMessages, getCache, shouldCache } from "./core/cache.js";
import { optimizeMessagesRequest } from "./core/optimizer.js";
import { forwardToAnthropic, webResponseToNodeStream } from "./upstream.js";
import { sha256Hex } from "./utils/hash.js";

function apiKeyFingerprint(req: { headers: Record<string, unknown> }): string {
  const k =
    config.fixedApiKey ?? (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : "");
  return k ? sha256Hex(k).slice(0, 16) : "anon";
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

async function handleV1Messages(req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
  const raw = req.body;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return reply.code(400).send({ error: "Expected JSON object body" });
  }

  let body = raw as Record<string, unknown>;
  body = optimizeMessagesRequest(body);

  const fingerprint = apiKeyFingerprint(req);
  const cache = getCache();
  const cacheable = shouldCache(body);
  const key = cacheKeyForMessages(body, fingerprint);

  if (cacheable) {
    const hit = await cache.get(key);
    if (hit) {
      reply.header("x-claude-saver-cache", "HIT");
      return reply.code(200).header("content-type", "application/json").send(JSON.parse(hit));
    }
  }

  const serialized = JSON.stringify(body);
  const upstream = await forwardToAnthropic(req, req.url, serialized);

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
  return reply.code(upstream.status).send(payload);
}

async function passthrough(req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
  const method = req.method;
  let serialized: string | undefined;
  if (method !== "GET" && method !== "HEAD" && req.body !== undefined) {
    serialized = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }

  const upstream = await forwardToAnthropic(req, req.url, serialized);

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

  app.get("/health", async () => ({ ok: true, service: "claude-saver" }));

  app.all("/v1/messages", async (req, reply) => {
    if (req.method !== "POST") return reply.code(405).send({ error: "Method Not Allowed" });
    return handleV1Messages(req, reply);
  });

  app.all("/v1/*", async (req, reply) => passthrough(req, reply));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    `Claude Saver proxy listening on http://${config.host}:${config.port} — set ANTHROPIC_BASE_URL to this origin for Claude Code CLI`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
