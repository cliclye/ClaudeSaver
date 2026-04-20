import { config } from "../config.js";

type Body = Record<string, unknown>;

export function routeModel(body: Body): Body {
  const model = body.model;
  if (typeof model !== "string") return body;

  const messages = body.messages;
  let text = "";
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const role = (m as { role?: string }).role;
      if (role !== "user" && role !== "assistant") continue;
      const c = (m as { content?: unknown }).content;
      if (typeof c === "string") {
        text += c;
      } else if (Array.isArray(c)) {
        for (const block of c) {
          if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
            const t = (block as { text?: string }).text;
            if (typeof t === "string") text += t;
          }
        }
      }
    }
  }

  const wantsSmart =
    text.length > 2000 ||
    /architecture|refactor|design|system/i.test(text) ||
    /```[\s\S]{4000,}/.test(text);

  const nextModel = wantsSmart ? config.smartModel : config.cheapModel;
  if (nextModel === model) return body;
  return { ...body, model: nextModel };
}
