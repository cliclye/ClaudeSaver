#!/usr/bin/env node
// Copies .env.example → .env if it does not exist, then prints next steps.
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dest = join(root, ".env");
const src = join(root, ".env.example");

if (!existsSync(src)) {
  console.error("Missing .env.example in project root.");
  process.exit(1);
}

if (existsSync(dest)) {
  console.log(".env already exists — left unchanged.");
} else {
  copyFileSync(src, dest);
  console.log("Created .env from .env.example.");
}

console.log(
  [
    "",
    "Next steps:",
    "  1. npm run dev            # start the proxy (foreground, hot reload)",
    "  2. npm run claude         # launch Claude Code through the proxy",
    "",
    "Or run `npm run doctor` to check your environment.",
    "",
  ].join("\n"),
);
