// Deliverables: a 5 s 16:9 master (photo, a title low on the left, music,
// a 2 s end card) exported as versions in one MCP call, export_versions:
// 16:9, 9:16 and 1:1, each full and as a 3 s cut-down, plus a textless
// master. First check: true answers a contact sheet (saved to
// scratch/versions-sheet.png) and exports nothing. Then the browser's
// save dialog is replaced by one that keeps the bytes; each file is
// written to scratch/versions/ and ffprobe reads its size and length; each
// answers the loudness its mix reached (-16 asked). The project in the
// editor must be exactly as before.
async (page) => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const mcp = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const call = async (name, args) => {
    const r = await mcp(name, args);
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    return r.result.content;
  };
  const origin = await page.evaluate(() => location.origin);
  const [photo, music] = JSON.parse((await call("import_media", { files: [{ src: `${origin}/fixtures/media/photo.jpg` }, { src: `${origin}/fixtures/media/music-30s.mp3` }] }))[0].text);
  await call("add_media_clip", { asset_id: photo.id, start: 0, duration: 5 });
  await call("add_media_clip", { asset_id: music.id, start: 0, duration: 5 });
  await call("set_brand", { name: "Roast", primary: "#ff5a5f", url: "roast.example" });
  await call("add_text", { text: "Small batch", start: 0.5, duration: 2.5, x: -0.3, y: 0.33, role: "headline" });
  await call("add_ad_element", { element: "end_card", start: 3, duration: 2, headline: "Order today" });
  const before = await page.evaluate(() => ({ project: JSON.stringify(window.videoEditor.project()), undo: window.videoEditor.state().undoLabel }));

  // ---- look first ------------------------------------------------------------------
  const ask = { ratios: ["16:9", "9:16", "1:1"], durations: [5, 3], textless: true, resolution: "480p", loudness: -16 };
  const sheet = await call("export_versions", { ...ask, check: true });
  fs.mkdirSync("__REPO__/scratch/versions", { recursive: true });
  fs.writeFileSync("__REPO__/scratch/versions-sheet.png", Buffer.from(sheet[0].data, "base64"));
  details.check = { ok: sheet[0].type === "image" && JSON.parse(sheet[1].text).versions === 7 };

  // ---- export ----------------------------------------------------------------------
  await page.evaluate(() => {
    window.__files = {};
    window.showSaveFilePicker = async (o) => ({
      name: o.suggestedName,
      createWritable: async () => {
        let buf = new Uint8Array(1 << 20), size = 0;
        return {
          write: async (c) => {
            const end = c.position + c.data.byteLength;
            if (end > buf.length) {
              const grown = new Uint8Array(Math.max(end, buf.length * 2));
              grown.set(buf.subarray(0, size));
              buf = grown;
            }
            buf.set(c.data, c.position);
            size = Math.max(size, end);
          },
          close: async () => {
            let s = "";
            const b = buf.subarray(0, size);
            for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
            window.__files[o.suggestedName] = btoa(s);
          },
          abort: async () => {},
        };
      },
    });
  });
  const started = Date.now();
  const done = JSON.parse((await call("export_versions", ask))[0].text);
  details.seconds = { ok: true, seconds: (Date.now() - started) / 1000 };
  const files = await page.evaluate(() => window.__files);
  const probed = [];
  for (const v of done.versions ?? []) {
    const b64 = files[v.path];
    if (!b64) {
      probed.push({ name: v.name, missing: true });
      continue;
    }
    const out = path.join("__REPO__/scratch/versions", v.path);
    fs.writeFileSync(out, Buffer.from(b64, "base64"));
    const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", out]).toString());
    const video = info.streams.find((s) => s.codec_type === "video");
    probed.push({ name: v.name, width: video?.width, height: video?.height, audio: info.streams.some((s) => s.codec_type === "audio"), duration: +(+info.format.duration).toFixed(2), want: [v.width, v.height, v.seconds] });
  }
  details.files = {
    ok: probed.length === 7 && probed.every((p) => !p.missing && p.width === p.want[0] && p.height === p.want[1] && Math.abs(p.duration - p.want[2]) < 0.15 && p.audio),
    probed,
  };
  const named = (re) => probed.filter((p) => re.test(p.name));
  const shapes = {
    wide: named(/ 16x9/).every((p) => p.width > p.height),
    tall: named(/ 9x16/).every((p) => p.height > p.width),
    square: named(/ 1x1/).every((p) => p.height === p.width),
    cut: named(/ 3s/).length === 3 && named(/ 3s/).every((p) => Math.abs(p.duration - 3) < 0.15),
  };
  details.shapes = { ok: Object.values(shapes).every(Boolean), ...shapes };
  // Each file answers the loudness its mix reached, as export_video does (ADR-103).
  const levels = (done.versions ?? []).map((v) => ({ name: v.name, loudness: v.loudness, info: v.info }));
  details.loudness = { ok: levels.length === 7 && levels.every((v) => v.loudness && Math.abs(v.loudness.integrated + 16) < 1.5 && v.loudness.truePeak <= -0.9), levels };
  details.names = { ok: (done.versions ?? []).map((v) => v.name.replace(/^.*? (?=\d+x\d+)/, "")).join(", ") === "16x9, 16x9 3s, 9x16, 9x16 3s, 1x1, 1x1 3s, 16x9 textless", names: (done.versions ?? []).map((v) => v.name) };
  const after = await page.evaluate(() => ({ project: JSON.stringify(window.videoEditor.project()), undo: window.videoEditor.state().undoLabel }));
  details.untouched = { ok: after.project === before.project && after.undo === before.undo };
  const status = JSON.parse((await call("export_status", {}))[0].text);
  details.status = { ok: status.state === "done" && status.versions?.length === 7 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
