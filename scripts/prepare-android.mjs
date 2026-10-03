import { copyFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "dist-android");
// Explicit allowlist: never copy dist/, .local/, public/data or player archives.
const icons = ["icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "manifest.webmanifest"];
await Promise.all(icons.map((name) => copyFile(join(root, "public", name), join(output, name))));
const allowed = new Set(["index.html", "assets", ...icons]);
for (const entry of await readdir(output)) {
  if (!allowed.has(entry)) throw new Error(`Unexpected Android asset: ${entry}`);
}
console.log("Android web assets prepared; no save files, demo data or service worker included.");
