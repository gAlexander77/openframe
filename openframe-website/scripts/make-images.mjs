// Makes the site's icons and its social card from files already in the site:
//   public/icons/icon-32.png, icon-192.png, icon-512.png, apple-touch-icon.png
//     from public/favicon.svg (the app icon, copied from the app);
//   public/og.png, the 1200x630 Open Graph and Twitter card, drawn as HTML
//     in a headless browser (Inter from node_modules, the editor screenshot
//     from src/assets/screens/editor.webp).
//
//   node scripts/make-images.mjs [--channel msedge|chrome|chromium]
import { chromium } from "playwright-core";
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const channel = process.argv.includes("--channel") ? process.argv[process.argv.indexOf("--channel") + 1] : "msedge";
const svg = readFileSync(join(ROOT, "public/favicon.svg"));
mkdirSync(join(ROOT, "public/icons"), { recursive: true });

for (const [name, size] of [["icon-32.png", 32], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(join(ROOT, "public/icons", name));
}
// Apple draws its own rounded corners on a full-bleed square.
await sharp(await sharp(svg, { density: 384 }).resize(200, 200).png().toBuffer())
  .extract({ left: 10, top: 10, width: 180, height: 180 })
  .flatten({ background: "#0b0c10" })
  .png()
  .toFile(join(ROOT, "public/icons/apple-touch-icon.png"));

const b64 = (buf) => buf.toString("base64");
const font = b64(readFileSync(join(ROOT, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")));
const shot = b64(await sharp(join(ROOT, "src/assets/screens/editor.webp")).resize(1300).jpeg({ quality: 86 }).toBuffer());
const icon = b64(svg);

const html = `<!doctype html><html><head><style>
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; background: #05060a; font-family: Inter; color: #e8eef8; position: relative; }
.glow-a { position: absolute; width: 900px; height: 900px; left: -320px; top: -420px; border-radius: 50%; background: radial-gradient(closest-side, rgb(47 123 255 / 38%), transparent 70%); }
.glow-b { position: absolute; width: 900px; height: 900px; right: -300px; bottom: -520px; border-radius: 50%; background: radial-gradient(closest-side, rgb(124 92 255 / 36%), transparent 70%); }
.copy { position: absolute; left: 72px; top: 92px; width: 560px; }
.brand { display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 700; letter-spacing: -0.02em; }
.brand img { width: 64px; height: 64px; }
h1 { margin-top: 44px; font-size: 64px; line-height: 1.02; letter-spacing: -0.045em; font-weight: 760; }
p { margin-top: 26px; font-size: 24px; line-height: 1.4; color: #a9b4c8; }
.window { position: absolute; left: 640px; top: 120px; width: 760px; border-radius: 18px; overflow: hidden; border: 1px solid rgb(255 255 255 / 16%); box-shadow: 0 40px 100px -20px rgb(0 0 0 / 80%), 0 0 120px -30px rgb(47 123 255 / 55%); }
.window img { display: block; width: 100%; }
.clips { position: absolute; left: 72px; bottom: 62px; display: flex; gap: 8px; }
.clips span { height: 10px; border-radius: 5px; }
</style></head><body>
<div class="glow-a"></div><div class="glow-b"></div>
<div class="window"><img src="data:image/jpeg;base64,${shot}"></div>
<div class="copy">
  <div class="brand"><img src="data:image/svg+xml;base64,${icon}">OpenFrame</div>
  <h1>The open video editor AI can drive.</h1>
  <p>Free and open source. Runs on your computer. Any AI agent can edit with you over MCP.</p>
</div>
<div class="clips"><span style="width:120px;background:#3be0f0"></span><span style="width:170px;background:#7c5cff"></span><span style="width:90px;background:#2fd27a"></span></div>
</body></html>`;

const browser = await chromium.launch({ channel, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: "png" });
  await sharp(png).png({ compressionLevel: 9, palette: false }).toFile(join(ROOT, "public/og.png"));
} finally {
  await browser.close();
}
console.log("icons and og.png written");
