#!/usr/bin/env node
// Launch `claude` with ANTHROPIC_BASE_URL pointed at a running Claude Saver proxy.
//
// Usage:
//   npm run claude              # subscription (Pro/Max) — strips ANTHROPIC_API_KEY
//   npm run claude -- --api-key # keep ANTHROPIC_API_KEY from env
//   npm run claude -- --        # extra args after `--` are forwarded to `claude`

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDashboardOnce, startTitleUpdater } from "./lib-terminal-ui.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

function expectedBuild() {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    const v = typeof pkg.version === "string" ? pkg.version : "0.0.0";
    let mtime = 0;
    for (const f of [
      join(repoRoot, "dist", "index.js"),
      join(repoRoot, "dist", "upstream.js"),
      join(repoRoot, "dist", "config.js"),
    ]) {
      try {
        const m = statSync(f).mtimeMs;
        if (m > mtime) mtime = m;
      } catch {
        // not built yet; fall through to source
      }
    }
    if (mtime === 0) {
      try {
        mtime = statSync(join(repoRoot, "src", "index.ts")).mtimeMs;
      } catch {
        mtime = Date.now();
      }
    }
    return `${v}+${Math.round(mtime)}`;
  } catch {
    return null;
  }
}

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
let noStatusline = false;
let noOpen = false;
let noTitle = false;
const passthrough = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--api-key") keepApiKey = true;
  else if (a === "--no-statusline") noStatusline = true;
  else if (a === "--no-open") noOpen = true;
  else if (a === "--no-title") noTitle = true;
  else if (a === "--") {
    passthrough.push(...argv.slice(i + 1));
    break;
  } else {
    passthrough.push(a);
  }
}

function ensureStatusLine() {
  try {
    const settingsFile = join(homedir(), ".claude", "settings.json");
    let current = {};
    if (existsSync(settingsFile)) {
      const raw = readFileSync(settingsFile, "utf8").trim();
      if (raw) current = JSON.parse(raw);
    }
    const cmd = current?.statusLine?.command;
    if (typeof cmd === "string" && cmd.includes("scripts/statusline.mjs")) return;
    const res = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-statusline.mjs")], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    if (res.status !== 0) {
      console.warn("  (could not install the Claude Saver status line automatically; continuing)");
    }
  } catch {
    // Non-fatal; just skip.
  }
}

async function probeHealth() {
  try {
    const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || j.ok !== true) return null;
    return j;
  } catch {
    return null;
  }
}

async function waitForHealth(ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const h = await probeHealth();
    if (h) return h;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

function killPidOnPort(port) {
  if (process.platform === "win32") return false;
  const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  const pids = (r.stdout || "")
    .split(/\s+/)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0 && n !== process.pid);
  if (!pids.length) return false;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore
    }
  }
  return true;
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

  const expected = expectedBuild();
  let health = await probeHealth();

  if (health && expected && health.build && health.build !== expected) {
    console.log(
      `Existing proxy at ${origin} is stale (build ${health.build} vs ${expected}). Restarting it ...`,
    );
    killPidOnPort(port);
    // Wait for the port to actually free up
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (!(await probeHealth())) break;
    }
    health = null;
  }

  if (!health) {
    console.log(`Starting Claude Saver proxy at ${origin} ...`);
    startProxyBackground();
    health = await waitForHealth();
    if (!health) {
      console.error(
        `Proxy did not become healthy at ${origin}. Run \`npm run dev\` in a separate terminal to see logs.`,
      );
      process.exit(1);
    }
  } else {
    console.log(`Using existing proxy at ${origin}.`);
  }

  if (!noStatusline) ensureStatusLine();
  if (!noOpen && openDashboardOnce(origin, "claude")) {
    console.log(`Opening Claude Saver dashboard at ${origin} ...`);
  }
  const stopTitle = noTitle ? () => {} : startTitleUpdater({ origin, prefix: "Claude" });

  const childEnv = { ...process.env, ANTHROPIC_BASE_URL: origin };
  if (!keepApiKey) {
    // Default to subscription mode: strip so OAuth Bearer token is used by `claude`.
    delete childEnv.ANTHROPIC_API_KEY;
  }

  const cc = spawn("claude", passthrough, { stdio: "inherit", env: childEnv });
  cc.on("exit", (code, sig) => {
    stopTitle();
    if (sig) process.kill(process.pid, sig);
    else process.exit(code ?? 0);
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
