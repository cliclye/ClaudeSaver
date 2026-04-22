#!/usr/bin/env node
// Claude Code status line that indicates whether Claude Saver is active.
//
// Claude Code pipes a JSON session blob on stdin and displays whatever we print to stdout.
// Docs: https://code.claude.com/docs/en/statusline
//
// Config hint (auto-installed by `npm run install-statusline`):
//   {
//     "statusLine": {
//       "type": "command",
//       "command": "node /abs/path/to/scripts/statusline.mjs",
//       "padding": 2,
//       "refreshInterval": 5
//     }
//   }

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

function loadDotenv() {
  const file = join(repoRoot, ".env");
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    out[s.slice(0, eq).trim()] = s.slice(eq + 1).trim();
  }
  return out;
}

async function readStdinJSON() {
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function isSaverHealthy(origin) {
  try {
    const r = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(400) });
    if (!r.ok) return false;
    const j = await r.json();
    return j && j.ok === true;
  } catch {
    return false;
  }
}

async function fetchStats(origin) {
  try {
    const r = await fetch(`${origin}/stats`, { signal: AbortSignal.timeout(400) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function fmtTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtUsd(n) {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

(async () => {
  const env = loadDotenv();
  const host = (process.env.HOST || env.HOST || "127.0.0.1").trim();
  const port = (process.env.PORT || env.PORT || "8766").trim();
  const origin = `http://${host}:${port}`;

  const [session, healthy] = await Promise.all([readStdinJSON(), isSaverHealthy(origin)]);
  const stats = healthy ? await fetchStats(origin) : null;

  const modelName =
    session?.model?.display_name || session?.model?.id || "claude";
  const cwd = session?.workspace?.current_dir || session?.cwd || "";
  const dirLabel = cwd ? cwd.split("/").filter(Boolean).pop() : "";
  const pct = session?.context_window?.used_percentage;
  const ctxLabel = typeof pct === "number" ? `${Math.round(pct)}% ctx` : "";

  const saver = healthy
    ? `${C.green}●${C.reset} ${C.bold}ClaudeSaver${C.reset}`
    : `${C.red}●${C.reset} ${C.bold}ClaudeSaver${C.reset} ${C.dim}offline${C.reset}`;

  const parts = [saver];
  if (healthy) parts.push(`${C.dim}${origin}${C.reset}`);
  parts.push(`${C.cyan}${modelName}${C.reset}`);
  if (dirLabel) parts.push(`${C.dim}${dirLabel}${C.reset}`);
  if (ctxLabel) parts.push(`${C.yellow}${ctxLabel}${C.reset}`);

  if (stats) {
    const tokens = stats.totalTokensSaved || 0;
    const usd = stats.totalUsdSaved || 0;
    if (tokens > 0 || usd > 0) {
      parts.push(
        `${C.green}saved ${fmtTokens(tokens)} tok${C.reset} ${C.dim}(${fmtUsd(usd)})${C.reset}`,
      );
    } else {
      parts.push(`${C.dim}saved 0${C.reset}`);
    }
  }

  process.stdout.write(parts.join(`${C.dim} · ${C.reset}`) + "\n");
})();
