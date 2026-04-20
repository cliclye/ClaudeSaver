type Msg = { role: string; content: unknown };

const REPLACEMENTS: [RegExp, string][] = [
  [/please\s+carefully\s+analyze\s+and\s+fix\s+the\s+following\s+code/gi, "FIX_CODE"],
  [/please\s+fix\s+this\s+code/gi, "FIX_CODE"],
  [/please\s+explain/gi, "EXPLAIN"],
];

function applyReplacements(s: string): string {
  let c = s;
  for (const [re, rep] of REPLACEMENTS) c = c.replace(re, rep);
  return c;
}

function compressContent(content: unknown): unknown {
  if (typeof content === "string") return applyReplacements(content);
  if (!Array.isArray(content)) return content;
  return content.map((block) => {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: string }).text === "string"
    ) {
      const b = block as { text: string };
      return { ...block, text: applyReplacements(b.text) };
    }
    return block;
  });
}

export function compressMessagesBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const b = body as Record<string, unknown>;
  const messages = b.messages;
  if (!Array.isArray(messages)) return body;

  const next = messages.map((m: Msg) => {
    if (m.role !== "user" && m.role !== "assistant") return m;
    return { ...m, content: compressContent(m.content) };
  });

  return { ...b, messages: next };
}
