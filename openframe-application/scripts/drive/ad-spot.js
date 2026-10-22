// End to end: a 15 s product ad made only through MCP tools/call, the way
// an agent drives the app. new_project (16:9); import the footage, a photo,
// music and a logo (drawn here and saved to scratch/, like a file a client
// sends); set_brand; an opening push-in on the photo with a kinetic
// headline and label; the person with a huge title behind them
// (text_behind_subject; skipped with the tool's reason when the model
// cannot be downloaded) and a lower third; a second framing of the photo
// with an offer badge and a call to action; an end card; music faded in
// and out. Then preview_frames, saved to scratch/ad-spot-sheet.png to be
// looked at, export_versions check (scratch/ad-spot-versions.png), and the
// deliverables exported (16:9, a 6 s 9:16 cut-down, 1:1) through a save
// dialog that keeps the bytes, each read back with ffprobe.
async (page) => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  const details = {};
  const log = [];
  let id = 1;
  const rpc = (name, args) => page.evaluate(([name, args, id]) => window.videoEditor.mcp({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }), [name, args, id++]);
  const call = async (name, args = {}) => {
    const r = await rpc(name, args);
    if (r.error) throw new Error(`${name}: ${r.error.message}`);
    if (r.result.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    log.push(name);
    const c = r.result.content;
    return c[0].type === "text" ? JSON.parse(c[0].text) : c;
  };
  const added = (r, type) => (r.added_clips ?? []).filter((c) => !type || c.type === type);

  // The client's logo: a coral disc and a wordmark on transparency.
  const logo = await page.evaluate(async () => {
    const c = new OffscreenCanvas(900, 300);
    const g = c.getContext("2d");
    g.fillStyle = "#ff5a5f";
    g.beginPath();
    g.arc(150, 150, 130, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "bold 170px Arial Black, Arial";
    g.fillText("R", 150, 160);
    g.textAlign = "left";
    g.font = "bold 120px Arial Black, Arial";
    g.fillText("ROAST", 310, 160);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.mkdirSync("__REPO__/scratch/ad-spot", { recursive: true });
  fs.writeFileSync("__REPO__/scratch/ad-logo.png", Buffer.from(logo, "base64"));
  const origin = await page.evaluate(() => location.origin);

  // ---- project, media, brand -----------------------------------------------------------
  await call("new_project", { name: "Roast spot" });
  const media = await call("import_media", {
    files: [
      { src: `${origin}/fixtures/media/photo.jpg`, name: "product.jpg" },
      { src: `${origin}/fixtures/media/person-pan.mp4`, name: "roaster.mp4" },
      { src: `${origin}/fixtures/media/music-30s.mp3`, name: "music.mp3" },
      { src: `${origin}/scratch/ad-logo.png`, name: "logo.png" },
    ],
  });
  const [photo, person, music, mark] = media;
  await call("set_brand", { name: "Roast", primary: "#ff5a5f", secondary: "#2b2d42", accent: "#ffd23f", background: "#1b1b2f", text: "#ffffff", heading_font: "Arial Black", body_font: "Segoe UI", logo_light: mark.id, url: "roast.example", tagline: "Small batch, big flavor" });

  // ---- the shots ------------------------------------------------------------------------
  const shotA = added(await call("add_media_clip", { asset_id: photo.id, start: 0, duration: 4.5 }))[0].id;
  const shotB = added(await call("add_media_clip", { asset_id: person.id, start: 4.5, duration: 5 }))[0].id;
  const shotC = added(await call("add_media_clip", { asset_id: photo.id, start: 9.5, duration: 3 }))[0].id;
  await call("frame_region", { clip_id: shotA, region: { x: 0, y: 0, w: 1, h: 1 }, to_region: { x: 0.25, y: 0.2, w: 0.55, h: 0.55 } });
  await call("frame_region", { clip_id: shotC, region: { x: 0.45, y: 0.15, w: 0.5, h: 0.5 }, to_region: { x: 0.5, y: 0.2, w: 0.42, h: 0.42 } });
  await call("set_transition", { clip_id: shotA, type: "dissolve", duration: 0.5 });
  await call("set_transition", { clip_id: shotB, type: "dissolve", duration: 0.5 });

  // ---- opening: label and kinetic headline ------------------------------------------------
  const label = added(await call("add_text", { text: "New single origin", start: 0.3, duration: 3.9, y: -0.17, role: "label" }))[0].id;
  const headline = added(await call("add_text", { text: "Small batch.\nBig flavor.", start: 0.6, duration: 3.6, y: 0.02, role: "headline", style: { size: 120 } }))[0].id;
  await call("batch", {
    commands: [
      { command: "set_animation", args: { clip_id: label, slot: "in", type: "letterFade", duration: 0.8 } },
      { command: "set_animation", args: { clip_id: label, slot: "out", type: "fade", duration: 0.3 } },
      { command: "set_animation", args: { clip_id: headline, slot: "in", type: "wordPop", duration: 1 } },
      { command: "set_animation", args: { clip_id: headline, slot: "out", type: "fade", duration: 0.3 } },
    ],
  });

  // ---- the roaster: a title behind them, then a lower third ---------------------------------
  const big = added(await call("add_text", { text: "ROAST", start: 4.7, duration: 2.4, y: -0.02, style: { size: 360, letterSpacing: 12, color: "#ffffff", shadow: { color: "#00000066", blur: 30, y: 6 } } }))[0].id;
  await call("set_animation", { clip_id: big, slot: "in", type: "letterRise", duration: 0.8 });
  await call("set_animation", { clip_id: big, slot: "out", type: "fade", duration: 0.3 });
  const behind = await rpc("text_behind_subject", { clip_id: shotB, text_clip_ids: [big] });
  if (behind.result.isError) details.textBehind = { ok: /download|internet|network|fetch/i.test(behind.result.content[0].text), skipped: behind.result.content[0].text };
  else details.textBehind = { ok: !!JSON.parse(behind.result.content[0].text).subject_clip_id };
  await call("add_ad_element", { element: "lower_third", start: 7.2, duration: 2.2, headline: "Mia Chen", subline: "Head roaster" });

  // ---- the offer -------------------------------------------------------------------------
  await call("add_ad_element", { element: "offer_badge", start: 9.7, duration: 2.7, headline: "-30%", subline: "This week" });
  await call("add_ad_element", { element: "cta_button", start: 10.2, duration: 2.2, cta: "Order now" });

  // ---- end card and music ----------------------------------------------------------------
  await call("add_ad_element", { element: "end_card", start: 12.5, duration: 2.5, headline: "Fresh roast, every morning", cta: "Order now" });
  const track = added(await call("add_media_clip", { asset_id: music.id, start: 0, duration: 15 }))[0].id;
  await call("set_fades", { clip_ids: [track], fade_in: 0.5, fade_out: 1.5 });
  await call("set_param", { clip_ids: [track], path: "volume", value: 0.8 });

  // ---- check the result ------------------------------------------------------------------
  const d = await call("describe_project");
  const clips = d.tracks.flatMap((t) => t.clips);
  const elements = ["Lower third", "Offer badge", "Call to action", "End card"].map((n) => ({ n, parts: clips.filter((c) => c.name === n).length }));
  const tune = await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id), track);
  details.timeline = {
    ok: d.duration === 15 && d.canvas.width === 1920 && d.brand?.logos?.light === mark.id && elements.every((e) => e.parts >= (e.n === "Call to action" ? 1 : 2)) && tune.fadeIn === 15 && tune.fadeOut === 45,
    duration: d.duration,
    elements,
    fades: [tune.fadeIn, tune.fadeOut],
  };
  const times = [0.4, 1.4, 3.6, 4.9, 6.2, 8.4, 10.1, 11.6, 13.4, 14.7];
  const sheet = await call("preview_frames", { times, columns: 5, tile_width: 384 });
  fs.writeFileSync("__REPO__/scratch/ad-spot-sheet.png", Buffer.from(sheet[0].data, "base64"));
  details.sheet = { ok: sheet[0].type === "image" && sheet[0].data.length > 10000 };

  // ---- deliverables ------------------------------------------------------------------------
  const versions = [{ ratio: "16:9" }, { ratio: "9:16", duration: 6 }, { ratio: "1:1" }];
  const look = await call("export_versions", { versions, check: true });
  fs.writeFileSync("__REPO__/scratch/ad-spot-versions.png", Buffer.from(look[0].data, "base64"));
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
  const out = await call("export_versions", { versions, resolution: "480p", loudness: -14 });
  const files = await page.evaluate(() => window.__files);
  const probed = (out.versions ?? []).map((v) => {
    const file = path.join("__REPO__/scratch/ad-spot", v.path);
    fs.writeFileSync(file, Buffer.from(files[v.path] ?? "", "base64"));
    const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file]).toString());
    const video = info.streams.find((s) => s.codec_type === "video");
    return { name: v.name, size: [video?.width, video?.height], seconds: +(+info.format.duration).toFixed(2), audio: info.streams.some((s) => s.codec_type === "audio") };
  });
  details.deliverables = {
    ok: probed.length === 3 && probed[0].size.join("x") === "854x480" && Math.abs(probed[0].seconds - 15) < 0.15 && probed[1].size.join("x") === "480x854" && Math.abs(probed[1].seconds - 6) < 0.15 && probed[2].size.join("x") === "480x480" && probed.every((p) => p.audio),
    seconds: (Date.now() - started) / 1000,
    probed,
  };
  details.calls = { ok: true, count: log.length };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
