import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dest = join(root, ".env");
const src = join(root, ".env.example");

if (existsSync(dest)) {
  console.log(".env already exists; left unchanged.");
  process.exit(0);
}
if (!existsSync(src)) {
  console.error("Missing .env.example in project root.");
  process.exit(1);
}
copyFileSync(src, dest);
console.log("Created .env from .env.example — edit values if needed.");
