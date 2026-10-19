// Run one drive (scripts/drive/*.js) headless in the system Edge against
// the web dev server (npm run dev, :1420). Headless always: the machine
// stays in use while agents work, so no window may pop up.
//
// One-time setup (scratch/ is git-ignored):  npm i --prefix scratch playwright-core
// Usage:  node scripts/drive/run.mjs scripts/drive/framecode.js [--size 1600x950] [--base http://localhost:1430]
// --base points the drive at another dev server (a worktree's own port).
// Prints a summary, writes the full result to scratch/drive-<name>.json,
// and exits 1 when the drive did not pass.

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/drive/run.mjs scripts/drive/<name>.js [--size WxH]");
  process.exit(2);
}
const sizeArg = rest[rest.indexOf("--size") + 1];
const [width, height] = rest.includes("--size") ? sizeArg.split("x").map(Number) : [1600, 950];
const base = rest.includes("--base") ? rest[rest.indexOf("--base") + 1].replace(/\/$/, "") : "http://localhost:1420";

let chromium;
try {
  ({ chromium } = createRequire(resolve("scratch/package.json"))("playwright-core"));
} catch {
  console.error("playwright-core is missing: run  npm i --prefix scratch playwright-core");
  process.exit(2);
}

// A drive file is one function expression: async (page, ...) => result.
// Drives name the main checkout's server; --base swaps it for this run.
// __REPO__ is this checkout (desktop imports take real paths), so no
// drive carries a machine's folder layout.
const repo = resolve(".").replace(/\\/g, "/");
const drive = (0, eval)(readFileSync(file, "utf8").replaceAll("http://localhost:1420", base).replaceAll("__REPO__", repo).replaceAll("scripts/drive/shots/", "scratch/drive-shots/"));
// A fake microphone, granted without a prompt, for the voiceover drive.
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
let result;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.context().route("**/api/tags", (route) => route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { models: [{ name: "llama3.1:8b" }] } }));
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  // Drives written for an attached page (the desktop WebView) start with a
  // reload, which needs a page already on the app.
  await page.goto(`${base}/`);
  result = await drive(page);
} finally {
  await browser.close();
}

mkdirSync("scratch", { recursive: true });
const out = resolve("scratch", `drive-${basename(file, ".js")}.json`);
writeFileSync(out, JSON.stringify(result, null, 2));

// Drives report { ok, details } (details: an object of checks with ok, or a
// list of checks with pass); framecode reports { checked, bad }.
const failed = [];
if (Array.isArray(result?.details)) result.details.forEach((c) => c.pass === false && failed.push(c.name));
else if (result?.details) for (const [k, v] of Object.entries(result.details)) if (v && v.ok === false) failed.push(k);
const ok = result?.ok === true || (Array.isArray(result?.bad) && result.bad.length === 0);
console.log(`${basename(file)} at ${width}x${height}: ${ok ? "PASS" : "FAIL"}${result?.checked ? ` (${result.checked} frames checked)` : ""}`);
for (const name of failed) console.log(`  failed: ${name}`);
if (!ok && Array.isArray(result?.bad)) console.log(`  bad frames: ${JSON.stringify(result.bad.slice(0, 10))}`);
console.log(`  full result: ${out}`);
process.exit(ok ? 0 : 1);
