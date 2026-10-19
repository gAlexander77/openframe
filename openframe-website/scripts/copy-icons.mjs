// Copies the app's icon set into the website as plain SVG files, so the site
// shows the same drawings users see in the editor. The app re-exports its
// icons from Lucide in one file (src/icons/index.ts); this reads that list
// and writes each icon exactly as lucide-react draws it (24 box, stroke 2,
// round caps and joins, currentColor). The build never runs it: run it by
// hand when the app's set changes, and commit the SVGs.
//
//   node scripts/copy-icons.mjs <app icons index.ts> <lucide-react/dist/esm> src/icons
//
// Example from a checkout where the app's dependencies are installed:
//   node scripts/copy-icons.mjs ../src/icons/index.ts ../node_modules/lucide-react/dist/esm src/icons
// (after the move, ../openframe-application/... for both paths)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [, , appIcons, lucideEsm, outDir] = process.argv;
if (!appIcons || !lucideEsm || !outDir) {
  console.error("usage: node scripts/copy-icons.mjs <app icons index.ts> <lucide-react/dist/esm> <out dir>");
  process.exit(2);
}
const names = [...readFileSync(appIcons, "utf8").matchAll(/^\s+([A-Z][A-Za-z0-9]+),?$/gm)].map((m) => m[1]);
const map = readFileSync(join(lucideEsm, "lucide-react.mjs"), "utf8");
mkdirSync(outDir, { recursive: true });
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Za-z])([0-9])/g, "$1-$2").toLowerCase();
const done = [];
for (const name of names) {
  // Aliases (Loader2 is loader-circle) resolve through lucide-react's export map.
  const m = new RegExp(`default as ${name}\\b[^;]*?from '\\./icons/([a-z0-9-]+)\\.mjs'`).exec(map);
  if (!m) throw new Error("no icon " + name);
  const { __iconData } = await import(pathToFileURL(join(lucideEsm, "icons", m[1] + ".mjs")).href);
  const body = __iconData.node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ")}/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`;
  writeFileSync(join(outDir, kebab(name) + ".svg"), svg);
  done.push(kebab(name));
}
console.log(done.length, "icons:", done.join(" "));
