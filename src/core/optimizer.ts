import { config } from "../config.js";
import { compressMessagesBody } from "./compress.js";
import { routeModel } from "./router.js";

export function optimizeMessagesRequest(body: Record<string, unknown>): Record<string, unknown> {
  let b: Record<string, unknown> = { ...body };
  if (config.enableCompression) b = compressMessagesBody(b) as Record<string, unknown>;
  if (!config.skipModelRouting) b = routeModel(b);
  return b;
}
