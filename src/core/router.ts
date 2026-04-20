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

  const wantsPremium =
    wantsSmart &&
    (text.length > 18000 ||
      /```[\s\S]{12000,}/.test(text) ||
      /(architecture|refactor).*(system|codebase|entire)/i.test(text));

  let nextModel = config.cheapModel;
  if (wantsPremium) nextModel = config.premiumModel;
  else if (wantsSmart) nextModel = config.smartModel;

  if (nextModel === model) return body;
  return { ...body, model: nextModel };
}
