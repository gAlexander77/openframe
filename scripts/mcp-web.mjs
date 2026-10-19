// Serve the web build's MCP (window.videoEditor.mcp) over HTTP from a
// headless browser, so an MCP client or curl can drive OpenFrame without
// the desktop app: for trying the tools, and for testing a model against
// them. JSON-RPC in, JSON-RPC out, one request per POST (the desktop
// server's Streamable HTTP, without its token: it listens on 127.0.0.1).
//
// One-time setup (scratch/ is git-ignored):  npm i --prefix scratch playwright-core
// Usage:  node scripts/mcp-web.mjs [--base http://localhost:1420] [--port 47281] [--images scratch/mcp-images]
// --images also writes every image a tool returns to that folder and adds
// its path to the answer as text, for clients that cannot show images.
// Media: import_media takes the dev server's URLs, e.g.
// http://localhost:1420/fixtures/media/music-30s.mp3.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = arg("--base", "http://localhost:1420").replace(/\/$/, "");
const port = Number(arg("--port", "47281"));
const images = arg("--images", null);

const { chromium } = createRequire(resolve("scratch/package.json"))("playwright-core");
// Headless always: the machine stays in use while agents work.
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto(base);
await page.waitForFunction(() => !!window.videoEditor);

let shot = 0;
http
  .createServer(async (req, res) => {
    if (req.method !== "POST") return res.writeHead(405).end();
    let body = "";
    for await (const chunk of req) body += chunk;
    let out;
    try {
      out = await page.evaluate((m) => window.videoEditor.mcp(m), JSON.parse(body));
    } catch (e) {
      out = { jsonrpc: "2.0", id: null, error: { code: -32603, message: String(e.message ?? e) } };
    }
    if (!out) return res.writeHead(202).end();
    if (images && Array.isArray(out.result?.content)) {
      mkdirSync(images, { recursive: true });
      for (const c of [...out.result.content])
        if (c.type === "image") {
          const file = resolve(images, `${String(++shot).padStart(3, "0")}.png`).replace(/\\/g, "/");
          writeFileSync(file, Buffer.from(c.data, "base64"));
          out.result.content.push({ type: "text", text: `(image saved to ${file})` });
        }
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  })
  .listen(port, "127.0.0.1", () => console.log(`OpenFrame MCP (web build at ${base}) on http://127.0.0.1:${port}/mcp`));
