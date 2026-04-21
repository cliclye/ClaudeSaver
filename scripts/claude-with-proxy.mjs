#!/usr/bin/env node
// Launch `claude` with ANTHROPIC_BASE_URL pointed at a running Claude Saver proxy.
//
// Usage:
//   npm run claude              # subscription (Pro/Max) — strips ANTHROPIC_API_KEY
//   npm run claude -- --api-key # keep ANTHROPIC_API_KEY from env
//   npm run claude -- --        # extra args after `--` are forwarded to `claude`

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

function loadDotenv() {
  const file = join(repoRoot, ".env");
  const out = {};
  if (!existsSync(file)) return out;
  const txt = readFileSync(file, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const fileEnv = loadDotenv();
const host = (process.env.HOST || fileEnv.HOST || "127.0.0.1").trim();
const port = (process.env.PORT || fileEnv.PORT || "8766").trim();
const origin = `http://${host}:${port}`;

// Parse flags
const argv = process.argv.slice(2);
let keepApiKey = false;
const passthrough = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--api-key") keepApiKey = true;
  else if (a === "--") {
    passthrough.push(...argv.slice(i + 1));
    break;
  } else {
    passthrough.push(a);
  }
}

async function probeHealth() {
  try {
    const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const j = await res.json();
    return j && j.ok === true;
  } catch {
    return false;
  }
}

async function waitForHealth(ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await probeHealth()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function startProxyBackground() {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  return child;
}

function hasClaudeOnPath() {
  const pathSep = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of (process.env.PATH || "").split(pathSep)) {
    if (!dir) continue;
    for (const ext of exts) {
      if (existsSync(join(dir, `claude${ext}`))) return true;
    }
  }
  return false;
}

(async () => {
  if (!hasClaudeOnPath()) {
    console.error(
      "Could not find `claude` on PATH. Install Claude Code: https://code.claude.com/docs/en/install",
    );
    process.exit(127);
  }

  let alive = await probeHealth();
  if (!alive) {
    console.log(`Starting Claude Saver proxy at ${origin} ...`);
    startProxyBackground();
    alive = await waitForHealth();
    if (!alive) {
      console.error(
        `Proxy did not become healthy at ${origin}. Run \`npm run dev\` in a separate terminal to see logs.`,
      );
      process.exit(1);
    }
  } else {
    console.log(`Using existing proxy at ${origin}.`);
  }

  const childEnv = { ...process.env, ANTHROPIC_BASE_URL: origin };
  if (!keepApiKey) {
    // Default to subscription mode: strip so OAuth Bearer token is used by `claude`.
    delete childEnv.ANTHROPIC_API_KEY;
  }

  const cc = spawn("claude", passthrough, { stdio: "inherit", env: childEnv });
  cc.on("exit", (code, sig) => {
    if (sig) process.kill(process.pid, sig);
    else process.exit(code ?? 0);
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
