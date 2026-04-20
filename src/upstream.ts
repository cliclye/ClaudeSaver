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

function headerString(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length) return v[0];
  return undefined;
}

/**
 * Claude Code can authenticate with:
 * - `X-Api-Key` (Console API key / `ANTHROPIC_API_KEY`)
 * - `Authorization: Bearer …` (`ANTHROPIC_AUTH_TOKEN`, OAuth subscription, `CLAUDE_CODE_OAUTH_TOKEN`, gateways)
 *
 * If the client uses Bearer auth (typical for Pro/Max/Team subscription login), we must **not** inject a
 * server-side `ANTHROPIC_API_KEY` — that would send conflicting credentials to api.anthropic.com.
 */
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

  const authorization = headerString(req, "authorization");
  const usesBearer =
    typeof authorization === "string" && authorization.trim().toLowerCase().startsWith("bearer ");

  if (config.fixedApiKey && !usesBearer) out["x-api-key"] = config.fixedApiKey;

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
