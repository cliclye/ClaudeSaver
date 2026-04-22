// Shared helpers for the launcher scripts: open the dashboard once per origin and keep
// the terminal-window title updated with the live "saved" total. Used by claude-with-proxy.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, writeSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE_DIR = join(homedir(), ".claude-saver");
const STATE_FILE = join(STATE_DIR, "state.json");

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeState(s) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch {
    // best-effort
  }
}

/** Open the dashboard URL once per `(origin, label)` combo. */
export function openDashboardOnce(origin, label) {
  const s = readState();
  const key = `${label}:${origin}`;
  if (s.opened && s.opened[key]) return false;
  const opener =
    process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start"
    : "xdg-open";
  try {
    const args = process.platform === "win32" ? ["", origin] : [origin];
    spawn(opener, args, { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    return false;
  }
  s.opened = s.opened || {};
  s.opened[key] = Date.now();
  writeState(s);
  return true;
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

/**
 * Set the terminal window title via OSC 2. Writes to /dev/tty so the title
 * survives even when the foreground app is using the alternate screen (TUI apps).
 * On Windows we no-op.
 */
function writeTitle(text) {
  if (process.platform === "win32") return;
  try {
    const fd = openSync("/dev/tty", "w");
    writeSync(fd, `\x1b]2;${text}\x07`);
    closeSync(fd);
  } catch {
    // /dev/tty unavailable (CI, redirected); just ignore
  }
}

/**
 * Start an interval that updates the terminal title with the current saved-total. Returns a
 * `stop()` function that clears the interval and restores the original title.
 */
export function startTitleUpdater({ origin, prefix }) {
  if (process.platform === "win32") return () => {};

  let stopped = false;
  async function once() {
    try {
      const r = await fetch(`${origin}/stats`, { signal: AbortSignal.timeout(800) });
      if (!r.ok) return;
      const s = await r.json();
      const tok = fmtTokens(s.totalTokensSaved || 0);
      const usd = fmtUsd(s.totalUsdSaved || 0);
      writeTitle(`● ClaudeSaver ${prefix} · saved ${tok} tok · ${usd}`);
    } catch {
      writeTitle(`● ClaudeSaver ${prefix} · offline`);
    }
  }

  once();
  const t = setInterval(() => {
    if (stopped) return;
    once();
  }, 4000);
  if (t.unref) t.unref();

  return () => {
    stopped = true;
    clearInterval(t);
    // Restore a neutral title — most terminals show the working dir / shell again
    // automatically once the child exits, but emit a blank to be safe.
    writeTitle("");
  };
}

// Internal helper exported for tests
export { fmtTokens, fmtUsd };

// Silence unused-import warnings if a consumer only uses one helper
export const __dirname_helper = (url) => dirname(url);
export const __exists = existsSync;
