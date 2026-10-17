// Compound clips drive (ADR-037): proves, in the running app, that a
// compound clip looks, sounds and exports exactly like the clips it holds,
// and that it opens, edits, saves, breaks apart and undoes like CapCut's.
// Builds a timeline through window.videoEditor (framecode video, a title,
// a WAV with sharp tone onsets), then works the UI: selects the clips by
// clicking, Alt+G, double-click to open, Delete inside, the breadcrumb back
// out, Ctrl+Z, Alt+Shift+G. Viewer pixels and scopes are compared with the
// un-nested timeline's; an MP4 export's frames are read back with ffmpeg
// (the fixture draws its frame number as ten blocks) and a WAV export's
// tone onsets are compared sample for sample with the un-nested mix.
// Needs the dev server, fixtures (node scripts/make-fixtures.mjs) and
// ffmpeg on PATH; run with  node scripts/drive/run.mjs scripts/drive/compound-clips.js
async (page) => {
  page.setDefaultTimeout(20000);
  const base = "http://localhost:1420";
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const outDir = path.join(process.cwd(), "scratch");
  fs.mkdirSync(outDir, { recursive: true });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(base);
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();

  // Main: A [0,2) source 0, B [2,5) source 5 s, C [5,7) source 1 s; a title
  // over [2.5,4); the WAV from 2 s (tone onsets at 4, 6 and 8 s).
  const ids = await page.evaluate(async (base) => {
    const ve = window.videoEditor;
    const [fc, wav] = await ve.import([
      { name: "framecode-30.mp4", src: `${base}/fixtures/media/framecode-30.mp4` },
      { name: "voice-8s.wav", src: `${base}/fixtures/media/voice-8s.wav` },
    ]);
    const at = (s, type) => ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.start === s && c.type === type).id;
    ve.exec("add_media_clip", { asset_id: fc.id, start: 0, duration: 2 });
    ve.exec("add_media_clip", { asset_id: fc.id, start: 2, in: 5, duration: 3 });
    ve.exec("add_media_clip", { asset_id: fc.id, start: 5, in: 1, duration: 2 });
    ve.exec("add_text", { text: "Nested", start: 2.5, duration: 1.5, y: 0.3 });
    ve.exec("add_media_clip", { asset_id: wav.id, start: 2 });
    return { A: at(0, "video"), B: at(2, "video"), C: at(5, "video"), T: at(2.5, "text"), W: at(2, "audio") };
  }, base);
  const expected = (f) => (f < 60 ? f : f < 150 ? 150 + (f - 60) : 30 + (f - 150));
  const FRAMES = [30, 75, 100, 160, 200];

  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  const describe = () => page.evaluate(() => window.videoEditor.describe());
  const allClips = (d) => d.tracks.flatMap((t) => t.clips);
  const state = () => page.evaluate(() => {
    const s = window.videoEditor.state();
    return { nest: s.nest.map((e) => e.id), playhead: s.playhead, selection: s.selection };
  });
  const px = (f) =>
    page.evaluate(async (f) => {
      const ve = window.videoEditor;
      ve.seek(f);
      await new Promise((r) => setTimeout(r, 30));
      await ve.rendered();
      return Array.from(ve.pixels(160).data);
    }, f);
  const diff = (a, b) => {
    if (!a || !b || a.length !== b.length) return 255;
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    return d;
  };
  const pixelsMatch = async (ref) => {
    const out = {};
    for (const f of FRAMES) out[f] = diff(ref[f], await px(f));
    return out;
  };
  const scopes = () =>
    page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 400));
      return [...document.querySelectorAll(".scope-plot canvas")].map((c) => c.toDataURL());
    });
  const sh = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 30 });
  async function render(name, options) {
    const r = await page.evaluate(async (o) => {
      const r = await window.videoEditor.render(o);
      const buf = new Uint8Array(await (await fetch(r.url)).arrayBuffer());
      URL.revokeObjectURL(r.url);
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { frames: r.frames, fileName: r.fileName, b64: btoa(s) };
    }, options);
    const file = path.join(outDir, `compound-${name}.${r.fileName.split(".").pop()}`);
    fs.writeFileSync(file, Buffer.from(r.b64, "base64"));
    return { file, frames: r.frames };
  }
  function framecodes(file) {
    const W = 160, H = 90;
    const raw = sh("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v:0", "-vf", `scale=${W}:${H}:flags=area,format=gray`, "-f", "rawvideo", "-"]);
    const out = [];
    for (let o = 0; o + W * H <= raw.length; o += W * H) {
      let n = 0;
      for (let i = 0; i < 10; i++) if (raw[o + (H >> 1) * W + Math.floor((i + 0.5) * (W / 10))] > 128) n |= 1 << i;
      out.push(n);
    }
    return out;
  }
  function onsets(file) {
    const raw = sh("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]);
    const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2);
    return [4, 6, 8].map((t) => {
      for (let i = Math.round((t - 0.05) * 48000); i < pcm.length; i++) if (Math.abs(pcm[i]) > 0.1) return i;
      return null;
    });
  }
  const clipEl = (id) => page.locator(`[data-clip="${id}"]`);

  // ---- the un-nested reference ----------------------------------------------------------
  const ref = {};
  for (const f of FRAMES) ref[f] = await px(f);
  await page.locator(".player-scopes").click();
  await px(100);
  const refScopes = await scopes();
  await page.locator(".player-scopes").click();
  const refWav = await render("flat", { video: false, audioFormat: "wav" });
  const refOnsets = onsets(refWav.file);

  // ---- create: click the clips, Alt+G ------------------------------------------------------
  await clipEl(ids.B).click();
  for (const id of [ids.C, ids.T, ids.W]) await clipEl(id).click({ modifiers: ["Control"] });
  await page.keyboard.press("Alt+G");
  await page.waitForFunction(() => !!window.videoEditor.describe().compounds);
  let d = await describe();
  const K = allClips(d).find((c) => c.type === "compound");
  const inner = d.compounds?.[0];
  check("create", K && K.start === 2 && K.end === 10 && inner && allClips(inner).length === 4 && !allClips(d).some((c) => [ids.B, ids.C, ids.T, ids.W].includes(c.id)), {
    compoundClip: K,
    inner: inner && allClips(inner).map((c) => [c.id, c.type, c.start, c.end]),
    selected: (await state()).selection,
  });

  // ---- preview: the same pixels, scopes and sound ------------------------------------------
  const nestedPx = await pixelsMatch(ref);
  check("previewPixels", Object.values(nestedPx).every((x) => x <= 2), { maxDiffByFrame: nestedPx });
  await page.locator(".player-scopes").click();
  await px(100);
  const nestedScopes = await scopes();
  await page.locator(".player-scopes").click();
  check("scopes", refScopes.length > 0 && nestedScopes.length === refScopes.length && nestedScopes.every((s, i) => s === refScopes[i]), { scopes: refScopes.length });
  // Filmstrip (the nested timeline rendered) and waveform (the WAV inside).
  await page.waitForFunction(
    (id) => {
      const lit = (c) => {
        if (!c) return false;
        const g = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < g.length; i += 4) if (Math.max(g[i], g[i + 1], g[i + 2]) > 100 && g[i + 3] > 0) return true;
        return false;
      };
      const el = document.querySelector(`[data-clip="${id}"]`);
      return lit(el?.querySelector(".clip-strip")) && lit(el?.querySelector(".clip-wave"));
    },
    K.id,
    { timeout: 30000 },
  ).then(() => check("thumbnails", true), (e) => check("thumbnails", false, { error: String(e).slice(0, 200) }));

  // ---- export: every frame the right source frame, tones on their samples ---------------------
  const mp4 = await render("nested", { start: 0, end: 7 });
  const codes = framecodes(mp4.file);
  const bad = [];
  for (let n = 0; n < 210; n++) if (codes[n] !== expected(n)) bad.push({ n, want: expected(n), got: codes[n] });
  check("exportFrames", codes.length === 210 && bad.length === 0, { frames: codes.length, bad: bad.slice(0, 8) });
  const wav = await render("nested", { video: false, audioFormat: "wav" });
  const nestedOnsets = onsets(wav.file);
  check("exportSound", refOnsets.every((x, i) => x !== null && Math.abs(x - nestedOnsets[i]) <= 2), { refOnsets, nestedOnsets });

  // ---- its own settings act on the whole: half size leaves the corner empty ------------------
  await page.evaluate((id) => window.videoEditor.exec("set_param", { clip_ids: [id], path: "transform.scale", value: 0.5 }), K.id);
  const small = await px(75);
  // Frame 75 shows source frame 165, whose lowest bit lights the leftmost
  // block: the corner is white, until the picture shrinks away from it.
  const corner = (a) => a.slice(0, 3);
  check("ownTransform", corner(ref[75]).every((v) => v > 128) && corner(small).every((v) => v < 30), { cornerBefore: corner(ref[75]), cornerAfter: corner(small) });
  await page.keyboard.press("Control+Z");
  check("ownTransformUndo", diff(ref[75], await px(75)) <= 2);

  // ---- open: double-click, edit inside, the breadcrumb back out -------------------------------
  await px(100);
  await clipEl(K.id).dblclick();
  await page.locator(".tl-path").waitFor();
  let s = await state();
  const crumbs = await page.locator(".tl-path .tl-crumb").allTextContents();
  check("open", s.nest.length === 1 && s.playhead === 40 && (await clipEl(ids.T).count()) === 1 && (await clipEl(K.id).count()) === 0, { state: s, crumbs });
  // Inside, the viewer shows the nested timeline: inner frame 40 is what
  // the project showed at 100.
  check("openPixels", diff(ref[100], await px(40)) <= 2);
  await clipEl(ids.T).click();
  await page.keyboard.press("Delete");
  await page.waitForFunction((id) => !document.querySelector(`[data-clip="${id}"]`), ids.T);
  // Saved while open: the whole document, the edit inside included.
  await page.locator(".menubar-button", { hasText: /^File$/ }).click();
  await page.getByRole("menuitem", { name: /^Save project/ }).click();
  await page.waitForFunction(() => /Saved/.test(document.querySelector(".save-state")?.textContent ?? ""));
  const stored = await page.evaluate(async () => {
    const id = window.videoEditor.project().id;
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("projects");
    return JSON.parse(await (await (await dir.getFileHandle(`${id}.json`)).getFile()).text());
  });
  const storedK = stored.tracks.flatMap((t) => t.clips).find((c) => c.type === "compound");
  check("saveWhileOpen", !!storedK && stored.compounds?.length === 1 && stored.compounds[0].tracks.flatMap((t) => t.clips).length === 3, {
    rootClips: stored.tracks.flatMap((t) => t.clips).map((c) => c.type),
  });
  await page.locator(".tl-path .tl-crumb").first().click();
  await page.waitForFunction(() => window.videoEditor.state().nest.length === 0);
  s = await state();
  d = await describe();
  check("back", s.playhead === 100 && s.selection[0] === K.id && allClips(d.compounds[0]).length === 3);
  check("editShows", diff(ref[100], await px(100)) > 30, { maxDiff: diff(ref[100], await px(100)) });
  // One history: undo at the root takes back the edit made inside.
  await page.keyboard.press("Control+Z");
  d = await describe();
  check("undoInside", allClips(d.compounds[0]).length === 4 && diff(ref[100], await px(100)) <= 2);

  // ---- break apart: everything back where it was ---------------------------------------------
  await clipEl(K.id).click();
  await page.keyboard.press("Alt+Shift+G");
  await page.waitForFunction(() => !window.videoEditor.describe().compounds);
  d = await describe();
  const back = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, allClips(d).find((c) => c.id === id)]));
  check("breakApart", back.B?.start === 2 && back.B.in === 5 && back.C?.start === 5 && back.T?.start === 2.5 && back.W?.start === 2 && !allClips(d).some((c) => c.type === "compound"), {
    back: Object.fromEntries(Object.entries(back).map(([k, c]) => [k, c && [c.start, c.end, c.in]])),
    selection: (await state()).selection.length,
  });
  const brokenPx = await pixelsMatch(ref);
  check("breakPixels", Object.values(brokenPx).every((x) => x <= 2), { maxDiffByFrame: brokenPx });
  await page.keyboard.press("Control+Z");
  d = await describe();
  check("undoBreak", allClips(d).some((c) => c.id === K.id) && d.compounds?.length === 1);
  await page.keyboard.press("Control+Shift+Z");
  d = await describe();
  check("redoBreak", !d.compounds && allClips(d).some((c) => c.id === ids.T));

  // ---- a saved compound opens again ------------------------------------------------------------
  await page.keyboard.press("Control+Z");
  const { id: pid, name } = await page.evaluate(() => window.videoEditor.project());
  await page.locator(".menubar-button", { hasText: /^File$/ }).click();
  await page.getByRole("menuitem", { name: /^Open project/ }).click();
  await page.locator(".create-card").waitFor();
  await page.locator(".home-search input").fill(name);
  await page.waitForFunction(() => document.querySelectorAll(".project-card").length === 1);
  await page.locator(".project-card").click();
  await page.waitForFunction((pid) => !!document.querySelector(".timeline-panel") && window.videoEditor.project().id === pid, pid);
  d = await describe();
  check("reopen", d.compounds?.length === 1 && allClips(d).some((c) => c.type === "compound") && diff(ref[100], await px(100)) <= 2);

  check("noErrors", errors.length === 0, { errors: errors.slice(0, 5) });
  return { ok: Object.values(details).every((x) => x.ok), details };
};
