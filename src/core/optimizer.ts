import { config } from "../config.js";
import { compressMessagesBody } from "./compress.js";
import { routeModel } from "./router.js";

export interface OptimizeResult {
  body: Record<string, unknown>;
  /** Model id requested by the client, before any routing. */
  originalModel: string;
  /** Model id we are actually sending to Anthropic (may equal `originalModel`). */
  chosenModel: string;
}

export function optimizeMessagesRequest(body: Record<string, unknown>): OptimizeResult {
  let b: Record<string, unknown> = { ...body };
  const originalModel = typeof b.model === "string" ? b.model : "";
  if (config.enableCompression) b = compressMessagesBody(b) as Record<string, unknown>;
  if (!config.skipModelRouting) b = routeModel(b);
  const chosenModel = typeof b.model === "string" ? b.model : originalModel;
  return { body: b, originalModel, chosenModel };
}
