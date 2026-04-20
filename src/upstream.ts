import type { FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { config } from "./config.js";

const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function buildUpstreamHeaders(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k0, v] of Object.entries(req.headers)) {
    const k = k0.toLowerCase();
    if (HOP.has(k)) continue;
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length) out[k0] = v.join(", ");
    } else {
      out[k0] = v;
    }
  }
  const key = config.fixedApiKey ?? (req.headers["x-api-key"] as string | undefined);
  if (key) out["x-api-key"] = key;
  return out;
}

export async function forwardToAnthropic(
  req: FastifyRequest,
  upstreamPathAndQuery: string,
  body: string | undefined,
): Promise<Response> {
  const url = `${config.upstreamUrl}${upstreamPathAndQuery}`;
  const headers = buildUpstreamHeaders(req);
  if (body !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";

  return fetch(url, {
    method: req.method,
    headers,
    body: body ?? null,
  });
}

export function webResponseToNodeStream(res: Response): Readable | null {
  if (!res.body) return null;
  return Readable.fromWeb(res.body as import("stream/web").ReadableStream);
}
