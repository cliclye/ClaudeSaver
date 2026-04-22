#!/usr/bin/env node
// Install (or remove) the Claude Saver status line in Claude Code's user settings.
//
//   npm run install-statusline       # installs
//   npm run install-statusline -- --uninstall
//   npm run install-statusline -- --project   # writes to ./.claude/settings.json instead of ~/.claude/settings.json
//
// Docs: https://code.claude.com/docs/en/statusline

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const scriptPath = join(repoRoot, "scripts", "statusline.mjs");

const argv = process.argv.slice(2);
const uninstall = argv.includes("--uninstall") || argv.includes("-u");
const projectScope = argv.includes("--project");

const settingsDir = projectScope
  ? join(process.cwd(), ".claude")
  : join(homedir(), ".claude");
const settingsFile = join(settingsDir, "settings.json");

function readJSON(file) {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Could not parse ${file}: ${err.message}`);
    console.error("Fix the JSON or move the file aside, then re-run this command.");
    process.exit(1);
  }
}

function writeJSON(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

const settings = readJSON(settingsFile);

if (uninstall) {
  if (settings.statusLine) {
    delete settings.statusLine;
    writeJSON(settingsFile, settings);
    console.log(`Removed statusLine from ${settingsFile}`);
  } else {
    console.log(`No statusLine found in ${settingsFile}`);
  }
  process.exit(0);
}

const command = `node ${JSON.stringify(scriptPath).slice(1, -1)}`;

const existing = settings.statusLine;
settings.statusLine = {
  type: "command",
  command,
  padding: 2,
  refreshInterval: 5,
};

writeJSON(settingsFile, settings);

if (existing && JSON.stringify(existing) !== JSON.stringify(settings.statusLine)) {
  console.log(`Replaced previous statusLine in ${settingsFile}:`);
  console.log("  was:  " + JSON.stringify(existing));
  console.log("  now:  " + JSON.stringify(settings.statusLine));
} else {
  console.log(`Wrote statusLine to ${settingsFile}`);
}
console.log("");
console.log("Restart Claude Code (or open a new session) to see the status line.");
console.log("To remove later: npm run install-statusline -- --uninstall");
