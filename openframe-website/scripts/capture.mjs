// Captures the website's screenshots of OpenFrame from a running web build.
//
//   node scripts/capture.mjs --url http://localhost:1441 --media <demo media dir> [--only home,editor] [--channel msedge]
//
// - Headless, always: no window opens.
// - A fresh browser profile each run (in .cache/, git-ignored), so the app
//   starts on an empty Home screen and every run builds the same projects.
// - The demo content is imported through window.videoEditor.mcp, the same MCP
//   tools an agent uses: the CC0 and public-domain clips listed on the
//   site's Credits page, served from --media by a local server this script
//   starts on 127.0.0.1 (a random free port) and stops at the end.
// - Privacy: the AI assistant lists the local model server's models, and
//   model names can be personal, so the model list is stubbed
//   (llama3.1:8b). Every request that is not to the app or the media server
//   is refused, so nothing from this machine or the network reaches a shot.
//   The clock is fixed, so "Saved 10:42" reads the same on every run.
// - Output: src/assets/screens/<name>.webp at 2x (2880x1800 for the window),
//   near-lossless WebP.
//   Astro turns them into AVIF/WebP at build time. Look at every image
//   before committing (docs/Website.md, "Privacy checklist for media").
// - --record <dir>: also films the run (WebM in <dir>), with the main demo's
//   MCP calls paced like an agent's, and prints where that build starts and
//   ends in the video. make-readme-media.mjs cuts it into the README's
//   "an agent edits live" GIF, AI agent notices and all.
//
// The media folder must hold: launch.mp4 orbit.mp4 desert.mp4 station.mp4
// speedboat.mp4 harbor.mp4 falls.mp4 paris.mp4 skyline.mp4 golden.mp4
// lake.mp4 fog.mp4 sparkle.mp4 liftoff.m4a (see the Credits page for their
// sources; any clips with these names work, the shots just look different).
import { chromium } from "playwright-core";
import sharp from "sharp";
import http from "node:http";
import { createReadStream, statSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? ""]] : acc), []),
);
if (!args.url || !args.media) {
  console.error("usage: node scripts/capture.mjs --url <app dev server> --media <demo media dir> [--only name,name] [--channel msedge|chrome|chromium]");
  process.exit(2);
}
const APP = args.url.replace(/\/$/, "");
const MEDIA = resolve(args.media);
const OUT = resolve(ROOT, args.out ?? "src/assets/screens");
const only = args.only ? new Set(args.only.split(",")) : null;
const W = 1440, H = 900, DSF = 2;
const REC = args.record ? resolve(args.record) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FILES = [
  ["launch.mp4", "Launch.mp4"], ["orbit.mp4", "Orbit.mp4"], ["desert.mp4", "Coastline from orbit.mp4"], ["station.mp4", "Station.mp4"],
  ["speedboat.mp4", "Speedboat.mp4"], ["harbor.mp4", "Harbor.mp4"], ["falls.mp4", "Falls.mp4"], ["paris.mp4", "Paris dusk.mp4"],
  ["skyline.mp4", "Skyline.mp4"], ["golden.mp4", "Golden hour.mp4"], ["lake.mp4", "Lake drone.mp4"], ["fog.mp4", "Morning fog.mp4"],
  ["sparkle.mp4", "Sea sparkle.mp4"], ["liftoff.m4a", "Liftoff - 128 bpm.m4a"],
];
for (const [f] of FILES) if (!existsSync(join(MEDIA, f))) throw new Error(`missing demo media: ${join(MEDIA, f)}`);

// ---- a local media server: CORS and byte ranges, as mediabunny reads by range
const TYPES = { ".mp4": "video/mp4", ".m4a": "audio/mp4", ".png": "image/png", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
  if (req.method === "OPTIONS") return res.end();
  const name = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
  if (!FILES.some(([f]) => f === name)) { res.statusCode = 404; return res.end(); }
  const file = join(MEDIA, name);
  const st = statSync(file);
  res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (m) {
    const start = m[1] ? +m[1] : st.size - +m[2];
    const end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${st.size}`);
    res.setHeader("Content-Length", end - start + 1);
    return req.method === "HEAD" ? res.end() : createReadStream(file, { start, end }).pipe(res);
  }
  res.setHeader("Content-Length", st.size);
  return req.method === "HEAD" ? res.end() : createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const M = `http://127.0.0.1:${server.address().port}/`;

// ---- a fresh headless browser
const profile = join(ROOT, ".cache/capture-profile");
rmSync(profile, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const ctx = await chromium.launchPersistentContext(profile, {
  channel: args.channel ?? "msedge",
  headless: true,
  viewport: { width: W, height: H },
  deviceScaleFactor: DSF,
  locale: "en-US",
  timezoneId: "UTC",
  colorScheme: "dark",
  ...(REC ? { recordVideo: { dir: REC, size: { width: W, height: H } } } : {}),
  args: ["--hide-scrollbars", "--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"],
});
const appOrigin = new URL(APP).origin;
await ctx.route("**/*", (route) => {
  const u = new URL(route.request().url());
  // The local model server: one stock model, so no installed model's name shows.
  if (/^(127\.0\.0\.1|localhost):(11434|1234)$/.test(u.host)) {
    if (u.pathname.endsWith("/api/tags")) return route.fulfill({ json: { models: [{ name: "llama3.1:8b" }] }, headers: { "access-control-allow-origin": "*" } });
    if (u.pathname.endsWith("/v1/models")) return route.fulfill({ json: { data: [] }, headers: { "access-control-allow-origin": "*" } });
    return route.fulfill({ status: 503, body: "", headers: { "access-control-allow-origin": "*" } });
  }
  if (u.origin === appOrigin || u.href.startsWith(M) || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
  return route.abort();
});
// A fixed wall clock (timers still run): the title bar's "Saved 10:42".
await ctx.clock.setFixedTime(new Date("2026-10-18T10:42:00Z"));
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(30000);
page.on("pageerror", (e) => console.error("page error:", e.message));

const t0 = Date.now();
let pace = 0;
async function mcp(name, a = {}) {
  if (pace) await sleep(pace);
  const res = await page.evaluate(({ name, a }) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: a } }), { name, a });
  const text = (res?.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (res?.error || res?.result?.isError) throw new Error(`${name}: ${text || JSON.stringify(res?.error)}`);
  try { return JSON.parse(text); } catch { return text; }
}
const describe = () => page.evaluate(() => window.videoEditor.describe());
const settle = async (ms = 1200) => {
  await page.evaluate(() => window.videoEditor.rendered?.());
  await page.evaluate(() => document.fonts.ready);
  await sleep(ms);
};
// Toasts and tooltips come and go with timing; keep them out of the shots.
const QUIET = ".toast, .toasts, [class*='toast'], .tooltip, [role='tooltip'] { visibility: hidden !important; } * { caret-color: transparent !important; }";
async function shot(name, opts = {}) {
  if (only && !only.has(name)) return;
  await page.addStyleTag({ content: QUIET });
  await page.mouse.move(W - 2, H - 2);
  await settle(opts.wait ?? 900);
  const png = opts.element
    ? await page.locator(opts.element).first().screenshot({ animations: "disabled" })
    : await page.screenshot({ clip: opts.clip, animations: "disabled" });
  // Near-lossless WebP keeps the repository light; Astro makes the sizes.
  await sharp(png).webp({ quality: 92, effort: 6 }).toFile(join(OUT, name + ".webp"));
  console.log("captured", name);
}

// ---- build the demo projects through MCP, as an agent would
try {
await page.goto(APP + "/");
await page.waitForFunction(() => !!window.videoEditor);
await page.locator(".create-card").first().click();
await page.waitForFunction(() => window.videoEditor.platform && document.querySelector(".titlebar"));
await sleep(800);

async function makeSmall(name, w, h, clips, title, music, first = false) {
  // The first one names the project Create opened, so Home lists no empty one.
  await mcp(first ? "set_project" : "new_project", { name });
  if (w !== 1920 || h !== 1080) await mcp("set_project", { width: w, height: h });
  const list = clips.map(([f, n]) => ({ src: M + f, name: n })).concat(music ? [{ src: M + "liftoff.m4a", name: "Liftoff - 128 bpm.m4a" }] : []);
  const assets = await mcp("import_media", { files: list });
  let t = 0;
  const cmds = clips.map(([, , dur, inn], i) => {
    const c = { command: "add_media_clip", args: { asset_id: assets[i].id, start: t, duration: dur, in: inn } };
    t += dur;
    return c;
  });
  await mcp("batch", { commands: cmds });
  const main = (await describe()).tracks.find((k) => k.main);
  if (w < h) await mcp("set_canvas_fill", { clip_ids: main.clips.map((c) => c.id), fill: "blur", amount: 60 });
  if (w < h) await mcp("frame_clips", { clip_ids: main.clips.map((c) => c.id), mode: "fill" }).catch(() => {});
  await mcp("batch", { commands: main.clips.slice(0, -1).map((c) => ({ command: "set_transition", args: { clip_id: c.id, type: "dissolve", duration: 0.5 } })) });
  if (title) {
    await mcp("batch", { commands: [
      { command: "add_text", args: { text: title.text, start: 0.3, duration: 3, style: { font: "Inter", size: title.size, bold: true, color: "#ffffff", letterSpacing: 12, shadow: { color: "rgba(0,0,0,0.45)", blur: 28, x: 0, y: 5 } } } },
      { command: "set_animation", args: { clip_id: "$1", slot: "in", type: title.anim ?? "wordPop", duration: 0.8 } },
    ] });
  }
  if (music) await mcp("add_media_clip", { asset_id: assets.at(-1).id, start: 0, duration: t });
  await mcp("seek", { at: title?.seek ?? 1.5 });
  await settle(1500);
}

await makeSmall("Paris at Dusk - Reel", 1080, 1920, [["paris.mp4", "Paris dusk.mp4", 5, 2], ["skyline.mp4", "Skyline.mp4", 4, 1], ["golden.mp4", "Golden hour.mp4", 4, 0]], { text: "PARIS\nAFTER DARK", size: 120, seek: 2.2 }, false, true);
await makeSmall("Harbor Morning", 1920, 1080, [["harbor.mp4", "Harbor.mp4", 5, 1], ["fog.mp4", "Morning fog.mp4", 5, 0], ["sparkle.mp4", "Sea sparkle.mp4", 4, 0]], null, true);
await makeSmall("Coastline Drone Cut", 1920, 1080, [["speedboat.mp4", "Speedboat.mp4", 6, 5], ["lake.mp4", "Lake drone.mp4", 6, 2], ["falls.mp4", "Falls.mp4", 5, 0]], { text: "COASTLINE", size: 140, seek: 2.4 }, true);
await makeSmall("Launch Day Recap", 1920, 1080, [["launch.mp4", "Launch.mp4", 6, 2], ["station.mp4", "Station.mp4", 5, 0], ["orbit.mp4", "Orbit.mp4", 5, 0]], { text: "LAUNCH DAY", size: 130, seek: 2.6, anim: "letterRise" }, true);

// The main demo: "Beyond Blue", the project inside the launch film's footage.
await mcp("new_project", { name: "Beyond Blue" });
if (REC) {
  pace = 900;
  console.log(`record: the agent's build starts at ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
const assets = await mcp("import_media", { files: FILES.map(([f, n]) => ({ src: M + f, name: n })) });
const id = Object.fromEntries(assets.map((a) => [a.name, a.id]));
const bar = (60 / 128) * 4;
const seq = [
  ["Launch.mp4", 3, 0.6], ["Orbit.mp4", 2, 0], ["Coastline from orbit.mp4", 2, 0.2], ["Station.mp4", 1, 2],
  ["Speedboat.mp4", 2, 5.5], ["Harbor.mp4", 2, 0.5], ["Falls.mp4", 2, 1], ["Paris dusk.mp4", 2, 2],
  ["Skyline.mp4", 2, 1], ["Golden hour.mp4", 2, 0.5],
];
let t = 0;
const clipCmds = seq.map(([n, bars, inn]) => {
  const c = { command: "add_media_clip", args: { asset_id: id[n], start: +t.toFixed(4), duration: +(bars * bar).toFixed(4), in: inn } };
  t += bars * bar;
  return c;
});
const total = +t.toFixed(4);
await mcp("batch", { commands: clipCmds });
let d = await describe();
const tr = ["dissolve", "dissolve", "dissolve", "zoomPunch", "whipLeft", "dissolve", "dipWhite", "dissolve", "dissolve"];
await mcp("batch", { commands: d.tracks.find((k) => k.main).clips.slice(0, -1).map((c, i) => ({ command: "set_transition", args: { clip_id: c.id, type: tr[i], duration: tr[i] === "zoomPunch" || tr[i] === "whipLeft" ? 0.35 : 0.6 } })) });
await mcp("add_track", { kind: "video", name: "B-roll" });
d = await describe();
const broll = d.tracks.find((k) => k.name === "B-roll").id;
await mcp("batch", { commands: [
  { command: "add_media_clip", args: { asset_id: id["Lake drone.mp4"], start: 11 * bar, duration: bar, in: 3, track_id: broll } },
  { command: "add_media_clip", args: { asset_id: id["Sea sparkle.mp4"], start: 13 * bar, duration: bar, in: 2, track_id: broll } },
  { command: "add_media_clip", args: { asset_id: id["Morning fog.mp4"], start: 17 * bar, duration: bar, in: 1, track_id: broll } },
] });
await mcp("add_track", { kind: "video", name: "Titles" });
d = await describe();
const titles = d.tracks.find((k) => k.name === "Titles").id;
const big = { font: "Inter", size: 150, bold: true, color: "#ffffff", letterSpacing: 18, shadow: { color: "rgba(0,0,0,0.45)", blur: 30, x: 0, y: 6 } };
await mcp("batch", { commands: [
  { command: "add_text", args: { text: "BEYOND BLUE", start: 0.8, duration: 4.2, y: -0.02, style: big, track_id: titles } },
  { command: "set_animation", args: { clip_id: "$1", slot: "in", type: "letterRise", duration: 1.2 } },
  { command: "set_animation", args: { clip_id: "$1", slot: "out", type: "fade", duration: 0.4 } },
  { command: "add_text", args: { text: "THE WORLD BELOW", start: 8 * bar + 0.05, duration: 3.4, style: { ...big, size: 120, letterSpacing: 10 }, track_id: titles } },
  { command: "set_animation", args: { clip_id: "$4", slot: "in", type: "wordPop", duration: 0.7 } },
  { command: "set_animation", args: { clip_id: "$4", slot: "out", type: "fade", duration: 0.3 } },
  { command: "add_text", args: { text: "See you out there.", start: 18 * bar + 0.3, duration: 3.2, y: 0.02, style: { ...big, size: 96, letterSpacing: 2 }, track_id: titles } },
  { command: "set_animation", args: { clip_id: "$7", slot: "in", type: "typewriter", duration: 1.2 } },
] });
await mcp("add_text_template", { name: "location", start: 5 * bar + 0.4, texts: ["Low Earth Orbit", "27,600 km/h"] });
await mcp("add_text_template", { name: "location", start: 14 * bar + 0.3, texts: ["Paris", "France"] });
d = await describe();
const audioTrack = d.tracks.find((k) => k.kind === "audio");
await mcp("add_media_clip", { asset_id: id["Liftoff - 128 bpm.m4a"], start: 0, duration: total, ...(audioTrack ? { track_id: audioTrack.id } : {}) });
d = await describe();
const music = d.tracks.filter((k) => k.kind === "audio").flatMap((k) => k.clips)[0];
await mcp("set_fades", { clip_ids: [music.id], fade_in: 0.5, fade_out: 2 });
await mcp("add_track", { kind: "video", name: "Look" });
d = await describe();
const look = d.tracks.find((k) => k.name === "Look").id;
await mcp("add_adjustment_clip", { start: 0, duration: total, track_id: look });
d = await describe();
await mcp("set_filter", { clip_id: d.tracks.find((k) => k.name === "Look").clips[0].id, type: "cinematic", intensity: 0.45 });
await mcp("add_markers", { times: [0, 8 * bar, 16 * bar], label: "Section", color: "#7c5cff" }).catch(() => {});
await page.evaluate(() => window.videoEditor.action("zoomFit"));
if (REC) {
  await sleep(3500);
  pace = 0;
  console.log(`record: the agent's build ends at ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
d = await describe();
const clipNamed = (name) => d.tracks.flatMap((k) => k.clips).find((c) => d.assets.find((a) => a.id === c.asset)?.name === name);

// ---- the shots
// Home: the projects grid.
await page.evaluate(() => window.videoEditor.action("openProject"));
await page.waitForSelector(".project-card");
await page.evaluate(() => document.activeElement?.blur());
await sleep(2500);
await shot("home", { wait: 1500, clip: { x: 0, y: 0, width: W, height: 500 } });

// The editor on the drop: THE WORLD BELOW over the speedboat.
await mcp("open_project", { project: "Beyond Blue" });
await page.waitForSelector(".titlebar .export-btn");
await page.evaluate(() => window.videoEditor.action("zoomFit"));
d = await describe();
await mcp("seek", { at: 8 * bar + 1.2 });
await sleep(2500);
await shot("editor", { wait: 1500 });

// Color: the falls shot graded with the wheels, Adjust > Color wheel open.
const falls = clipNamed("Falls.mp4");
await mcp("set_color_wheel", { clip_id: falls.id, wheel: "lift", hue: 195, amount: 22 }).catch((e) => console.warn("color wheel:", e.message));
await mcp("set_color_wheel", { clip_id: falls.id, wheel: "gamma", hue: 32, amount: 16 }).catch(() => {});
await mcp("seek", { at: falls.start + 1.6 });
await page.evaluate((cid) => window.videoEditor.select([cid]), falls.id);
await sleep(500);
await page.locator("button", { hasText: /^Adjust$/ }).first().click().catch(() => {});
await sleep(300);
await page.locator("button", { hasText: /^Color wheel$/ }).first().click().catch(() => {});
await shot("color", { wait: 1500, clip: { x: 428, y: 38, width: W - 428, height: 500 } });
await page.evaluate(() => window.videoEditor.select([]));

// AI tools: the library's AI tools tab.
await page.locator("button", { hasText: /^AI tools$/ }).first().click().catch(() => {});
await shot("ai-tools", { wait: 1200, clip: { x: 0, y: 38, width: 1110, height: 500 } });
await page.locator("button", { hasText: /^Media$/ }).first().click().catch(() => {});

// Keyframes: a push-in on the orbit shot, the keyframe panel open.
const orbit = clipNamed("Orbit.mp4");
await mcp("add_keyframe", { clip_id: orbit.id, path: "transform.scale", at: orbit.start, value: 1 }).catch((e) => console.warn("keyframe:", e.message));
await mcp("add_keyframe", { clip_id: orbit.id, path: "transform.scale", at: orbit.end - 0.1, value: 1.3, ease: "easeInOut" }).catch(() => {});
await mcp("seek", { at: (orbit.start + orbit.end) / 2 });
await page.evaluate((cid) => window.videoEditor.select([cid]), orbit.id);
await page.evaluate(() => window.videoEditor.action("toggleKeyframePanel"));
await shot("keyframes", { wait: 1500 });
await page.evaluate(() => window.videoEditor.action("toggleKeyframePanel"));
await page.evaluate(() => window.videoEditor.select([]));

// The AI assistant: the docked column, its conversation tab with the
// stubbed model list.
await mcp("seek", { at: 8 * bar + 1.2 });
await page.locator(".assistant-btn").first().click();
await page.waitForSelector("aside.assistant");
await shot("assistant", { wait: 1500 });
await page.locator("button[aria-label='Close AI assistant']").first().click().catch(() => {});

// Export: the dialog with its presets.
await page.locator(".titlebar .export-btn").first().click();
await page.waitForSelector("[role='dialog']");
// The name field opens selected; a still shows it unselected.
await page.evaluate(() => document.activeElement?.blur());
await shot("export", { wait: 1800, element: "[role='dialog']" });
await page.keyboard.press("Escape");

// Keyboard shortcuts: the searchable list.
await page.evaluate(() => window.videoEditor.action("showShortcuts"));
await shot("shortcuts", { wait: 1200, element: "[role='dialog']" });
await page.keyboard.press("Escape");

console.log("done:", OUT);
} finally {
  // Always close the browser and the media server, even after a failure.
  await ctx.close().catch(() => {});
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
