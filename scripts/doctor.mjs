#!/usr/bin/env node
// Preflight checks for Claude Saver. Usage: `npm run doctor`
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const OK = "  \x1b[32mok\x1b[0m";
const WARN = "\x1b[33mwarn\x1b[0m";
const FAIL = "\x1b[31mfail\x1b[0m";

let hadFail = false;

function line(status, label, detail = "") {
  if (status === FAIL) hadFail = true;
  console.log(`  ${status}  ${label}${detail ? "  — " + detail : ""}`);
}

function loadDotenv() {
  const file = join(repoRoot, ".env");
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    out[s.slice(0, eq).trim()] = s.slice(eq + 1).trim();
  }
  return out;
}

function isPortFree(host, port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.unref();
    s.once("error", () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

async function probeHealth(origin) {
  try {
    const r = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

function hasOnPath(name) {
  const sep = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of (process.env.PATH || "").split(sep)) {
    if (!dir) continue;
    for (const ext of exts) if (existsSync(join(dir, `${name}${ext}`))) return true;
  }
  return false;
}

console.log("\nClaude Saver — doctor\n");

// Node version
const major = Number(process.versions.node.split(".")[0]);
if (major >= 20) line(OK, `Node.js ${process.versions.node}`);
else line(FAIL, `Node.js ${process.versions.node}`, "need >= 20");

// node_modules present
if (existsSync(join(repoRoot, "node_modules"))) line(OK, "dependencies installed");
else line(FAIL, "dependencies missing", "run `npm install`");

// .env
const env = loadDotenv();
if (existsSync(join(repoRoot, ".env"))) line(OK, ".env present");
else line(WARN, ".env missing", "run `npm run setup` (optional; defaults work)");

const host = (process.env.HOST || env.HOST || "127.0.0.1").trim();
const port = Number(process.env.PORT || env.PORT || 8766);
const origin = `http://${host}:${port}`;

// Port status
const running = await probeHealth(origin);
if (running) {
  line(OK, `proxy already running at ${origin}`);
} else {
  const free = await isPortFree(host, port);
  if (free) line(OK, `port ${port} free on ${host}`);
  else line(FAIL, `port ${port} in use on ${host}`, "set PORT in .env or free the port");
}

// claude CLI
if (hasOnPath("claude")) line(OK, "`claude` CLI on PATH");
else line(WARN, "`claude` CLI not on PATH", "install: https://code.claude.com/docs/en/install");

// API key hints
const anthKey = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY;
if (anthKey) line(OK, "ANTHROPIC_API_KEY set (Console/API path)");
else line(OK, "ANTHROPIC_API_KEY unset (subscription / OAuth path)");

console.log("");
console.log(`  Next: \`npm run dev\` (or \`npm start\` after \`npm run build\`).`);
console.log(`        Then \`npm run claude\`.`);
console.log("");

process.exit(hadFail ? 1 : 0);
