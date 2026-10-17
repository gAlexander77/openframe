// Remove background drive: proves CapCut's Remove BG end to end on a real
// person. The fixture (fixtures/media/person-pan.mp4, made by
// scripts/make-fixtures.mjs) is a CC0 portrait panned one pixel a frame,
// so where every point of the photo is on every frame is known: the face
// and jacket must stay, the foliage and the white column must go.
//   0. with Hugging Face unreachable on first use, the switch fails with a
//      message a person can act on and leaves the clip as it was;
//   1. processing through the inspector's Remove BG > Auto removal switch
//      shows the download, then the processing, each with rising progress,
//      keeps the page responsive, and lands as one undo step;
//   2. with a magenta clip on the track below, the viewer shows magenta
//      where the photo's background was and the untouched clip where the
//      person is;
//   3. an exported still and a rendered MP4 (decoded by ffmpeg) agree;
//   4. off keeps the matte, so on again is instant; undo restores;
//   5. playback with the matte drops no more frames than without (measured);
//   6. the AI tools card shows the job, and canceling leaves the clip as it
//      was;
//   7. the project saves, reloads and reopens with the background removed;
//   8. both models, scored on the same points: ormbg (the default where
//      WebGPU has fp16) and MediaPipe Selfie forced onto WASM (the fallback),
//      with their speed and the matte's size;
//   9. opening another project mid-matte cancels the job and leaves the new
//      project untouched.
// Needs the dev server, fixtures and ffmpeg on PATH. Run headless (a fresh
// browser, so the first use really downloads the model):
//   node scripts/drive/run.mjs scripts/drive/bg-removal.js [--base http://localhost:1440]
// Screenshots land in scripts/drive/shots/, the export in scratch/.
async (page, opts = {}) => {
  const base = opts.base ?? "http://localhost:1420";
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const shots = path.join(process.cwd(), "scripts", "drive", "shots");
  const outDir = path.join(process.cwd(), "scratch");
  fs.mkdirSync(shots, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const details = {};
  const MAGENTA = [255, 0, 255];
  // Points of the photo (scaled to 1215x810); frame n shows it from
  // x = 255 - n, y = 135 in a 960x540 window.
  const FG = [[675, 335], [665, 195], [655, 555], [375, 615], [975, 605]];
  const BG = [[355, 285], [315, 175], [1055, 285], [1035, 485], [875, 255], [116, 535]];
  const FRAMES = [0, 45, 90, 135, 179];
  const visible = ([sx, sy], n) => {
    const x = sx - 255 + n, y = sy - 135;
    return x >= 14 && x <= 946 && y >= 14 && y <= 526 ? [x, y] : null;
  };
  const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  const clipCutout = (id) => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id)?.cutout ?? null, id);

  await page.goto(base);
  await page.waitForFunction(() => !!window.videoEditor);
  if (await page.locator(".create-card").count()) await page.locator(".create-card").click();
  await page.waitForSelector(".timeline-panel");

  // ---- the timeline: magenta below, the person above --------------------------
  const ids = await page.evaluate(async (base) => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: "person-pan.mp4", src: `${base}/fixtures/media/person-pan.mp4` }]);
    ve.exec("set_project", { width: 960, height: 540 });
    ve.exec("add_color_clip", { color: "#ff00ff", start: 0, duration: 6 });
    ve.exec("add_track", { kind: "video", name: "Person" });
    ve.exec("add_media_clip", { asset_id: a.id, start: 0, track_id: ve.describe().tracks[0].id });
    const clip = ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.type === "video");
    window.__px = async (frame, points) => {
      ve.seek(frame);
      await new Promise((r) => setTimeout(r, 30));
      await ve.rendered();
      const { width, height, data } = ve.pixels();
      // 3x3 average around each point, in viewer pixels.
      return points.map(([x, y]) => {
        const cx = Math.round((x * width) / 960), cy = Math.round((y * height) / 540);
        const s = [0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (let c = 0; c < 3; c++) s[c] += data[((cy + dy) * width + cx + dx) * 4 + c];
        return s.map((v) => Math.round(v / 9));
      });
    };
    return { asset: a.id, clip: clip.id };
  }, base);

  const sample = async () => {
    const out = {};
    for (const n of FRAMES) {
      const fg = FG.map((p) => visible(p, n)).filter(Boolean);
      const bg = BG.map((p) => visible(p, n)).filter(Boolean);
      const px = await page.evaluate(([n, pts]) => window.__px(n, pts), [n, [...fg, ...bg]]);
      out[n] = { fg: px.slice(0, fg.length), bg: px.slice(fg.length) };
    }
    return out;
  };
  const before = await sample();

  await page.evaluate((id) => window.videoEditor.select([id]), ids.clip);
  await page.getByRole("tab", { name: "Video" }).click();
  await page.getByRole("radio", { name: "Remove BG" }).click();
  const sw = page.getByRole("switch", { name: "Remove background" });

  // ---- 0. the first download fails readably ------------------------------------
  const hf = /^https:\/\/([\w-]+\.)*(huggingface\.co|hf\.co)\//;
  // On the context: the download runs in the matte worker.
  await page.context().route(hf, (route) => route.abort("internetdisconnected"));
  try {
    await sw.click();
    const toast = await page.waitForFunction(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).find((t) => /download/i.test(t) && /model/i.test(t)) ?? null, null, { timeout: 60_000 });
    const message = await toast.jsonValue();
    await page.waitForFunction(() => !document.querySelector(".cutout-progress"));
    details.downloadFailure = { message, cutout: await clipCutout(ids.clip), switchOn: await sw.getAttribute("aria-checked") };
    details.downloadFailure.ok = /Couldn't download the background model/.test(message) && /internet/.test(message) && details.downloadFailure.cutout === null && details.downloadFailure.switchOn === "false";
  } finally {
    await page.context().unroute(hf);
  }

  // ---- 1. process through the inspector's switch ------------------------------
  // The page's responsiveness while it works: the longest gap between
  // animation frames and the main thread's long tasks.
  await page.evaluate(() => {
    const w = (window.__busy = { maxGap: 0, longTasks: 0, longest: 0, on: true });
    let last = performance.now();
    const tick = (t) => {
      w.maxGap = Math.max(w.maxGap, t - last);
      last = t;
      if (w.on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    w.observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => ((w.longTasks += 1), (w.longest = Math.max(w.longest, e.duration)))));
    w.observer.observe({ type: "longtask" });
  });
  const started = Date.now();
  await sw.click();
  const progress = [];
  let shotTaken = false;
  for (;;) {
    const s = await page.evaluate((id) => {
      const bar = document.querySelector(".cutout-progress");
      const c = window.videoEditor.project().tracks.flatMap((t) => t.clips).find((x) => x.id === id);
      // Step 0's message may still be showing; it is not this run's.
      const toasts = [...document.querySelectorAll(".toast")].map((t) => t.textContent).filter((t) => !/Couldn't download/.test(t));
      return { stage: bar?.getAttribute("aria-label") ?? null, pct: bar ? Number(bar.getAttribute("aria-valuenow")) : null, cutout: c.cutout ?? null, toast: toasts.join(" | ") };
    }, ids.clip);
    if (!shotTaken && /Removing/.test(s.stage ?? "") && s.pct >= 30) {
      shotTaken = true;
      await page.locator(".inspector-panel").screenshot({ path: path.join(shots, "bg-removal-progress.png") });
    }
    const lastSeen = progress.at(-1);
    if (s.pct !== null && (lastSeen?.stage !== s.stage || lastSeen?.pct !== s.pct)) progress.push({ stage: s.stage, pct: s.pct, at: Date.now() - started });
    if (s.cutout) {
      details.process = { cutout: s.cutout, toast: s.toast };
      break;
    }
    if (/rror|couldn|can't/i.test(s.toast)) throw new Error(`processing failed: ${s.toast}`);
    if (Date.now() - started > 600_000) throw new Error("processing took over 10 minutes");
    await page.waitForTimeout(100);
  }
  const seconds = (Date.now() - started) / 1000;
  const busy = await page.evaluate(() => {
    const w = window.__busy;
    w.on = false;
    w.observer.disconnect();
    return { maxFrameGapMs: Math.round(w.maxGap), longTasks: w.longTasks, longestTaskMs: Math.round(w.longest) };
  });
  await page.waitForFunction(() => /Background removed/.test(document.body.textContent));
  const state = await page.evaluate(() => window.videoEditor.state());
  const stages = [...new Set(progress.map((p) => p.stage))];
  const byStage = (st) => progress.filter((p) => p.stage === st).map((p) => p.pct);
  const downloading = stages.find((s) => /Downloading the background model/.test(s));
  const processing = stages.find((s) => /Removing the background of person-pan/.test(s));
  const rising = (xs) => xs.every((v, i) => i === 0 || v >= xs[i - 1]);
  const downloadEnd = progress.filter((p) => p.stage === downloading).at(-1)?.at ?? 0;
  Object.assign(details.process, {
    seconds,
    downloadSeconds: downloadEnd / 1000,
    stages,
    download: byStage(downloading).filter((_, i, a) => i % Math.ceil(a.length / 8) === 0 || i === a.length - 1),
    processing: byStage(processing).filter((_, i, a) => i % Math.ceil(a.length / 10) === 0 || i === a.length - 1),
    busy,
    undoLabel: state.undoLabel,
  });
  details.process.ok =
    details.process.cutout.enabled &&
    stages[0] === "Starting the background model" &&
    !!downloading &&
    !!processing &&
    stages.indexOf(downloading) < stages.indexOf(processing) &&
    rising(byStage(downloading)) &&
    byStage(processing).length >= 3 &&
    rising(byStage(processing)) &&
    byStage(processing).at(-1) >= 80 &&
    // The page keeps drawing while the model works: no frame gap long
    // enough to read as a freeze.
    busy.maxFrameGapMs < 250 &&
    state.undoLabel === "Remove background";

  // ---- 2. the viewer: magenta where the background was ------------------------
  const after = await sample();
  const judge = (on, off) => {
    const bad = [];
    for (const n of FRAMES) {
      on[n].fg.forEach((c, i) => near(c, off[n].fg[i], 16) || bad.push({ n, fg: i, got: c, want: off[n].fg[i] }));
      on[n].bg.forEach((c, i) => near(c, MAGENTA, 16) || bad.push({ n, bg: i, got: c }));
    }
    return bad;
  };
  const counts = (s) => FRAMES.reduce((a, n) => [a[0] + s[n].fg.length, a[1] + s[n].bg.length], [0, 0]);
  details.viewer = {
    points: counts(after),
    bad: judge(after, before),
    // The check bites: before processing no background point is magenta.
    magentaBefore: FRAMES.flatMap((n) => before[n].bg).filter((c) => near(c, MAGENTA, 16)).length,
  };
  details.viewer.ok = details.viewer.bad.length === 0 && details.viewer.magentaBefore === 0;
  await page.evaluate(() => window.videoEditor.seek(90));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, "bg-removal-app.png") });
  await page.locator(".player-canvas").screenshot({ path: path.join(shots, "bg-removal-viewer.png") });

  // ---- 3. export: a still and a rendered file ---------------------------------
  const still = await page.evaluate(async ([pts]) => {
    const r = await window.videoEditor.still(90, "1080p");
    const bmp = await createImageBitmap(await (await fetch(r.url)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const k = bmp.width / 960;
    return { size: [bmp.width, bmp.height], px: pts.map(([x, y]) => [...g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data.slice(0, 3)]) };
  }, [[...FG.map((p) => visible(p, 90)).filter(Boolean), ...BG.map((p) => visible(p, 90)).filter(Boolean)]]);
  const fgN = FG.map((p) => visible(p, 90)).filter(Boolean).length;
  details.still = {
    size: still.size,
    bad: [
      ...still.px.slice(0, fgN).flatMap((c, i) => (near(c, after[90].fg[i], 20) ? [] : [{ fg: i, got: c, viewer: after[90].fg[i] }])),
      ...still.px.slice(fgN).flatMap((c, i) => (near(c, MAGENTA, 16) ? [] : [{ bg: i, got: c }])),
    ],
  };
  details.still.ok = details.still.bad.length === 0;

  const rendered = await page.evaluate(async () => {
    const r = await window.videoEditor.render({});
    const buf = new Uint8Array(await (await fetch(r.url)).arrayBuffer());
    URL.revokeObjectURL(r.url);
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), frames: r.frames, elapsed: r.elapsed, fileName: r.fileName };
  });
  const file = path.join(outDir, `bg-removal.${rendered.fileName.split(".").pop()}`);
  fs.writeFileSync(file, Buffer.from(rendered.b64, "base64"));
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "scale=960:540,format=rgb24", "-f", "rawvideo", "-"], { maxBuffer: 1 << 30 });
  const frameBytes = 960 * 540 * 3;
  const exportBad = [];
  for (const n of FRAMES) {
    const at = ([x, y]) => [0, 1, 2].map((c) => raw[n * frameBytes + (y * 960 + x) * 3 + c]);
    FG.map((p) => visible(p, n)).filter(Boolean).forEach((p, i) => near(at(p), after[n].fg[i], 28) || exportBad.push({ n, fg: i, got: at(p), viewer: after[n].fg[i] }));
    BG.map((p) => visible(p, n)).filter(Boolean).forEach((p, i) => near(at(p), MAGENTA, 28) || exportBad.push({ n, bg: i, got: at(p) }));
  }
  details.export = { file: path.basename(file), frames: raw.length / frameBytes, renderSeconds: +rendered.elapsed.toFixed(2), bad: exportBad };
  details.export.ok = details.export.frames === 180 && exportBad.length === 0;

  // ---- 4. off keeps the matte; on is instant; undo ----------------------------
  // A gap on the main track (magnet on): switching is a look change and
  // must not let the magnet close it.
  const gapClip = await page.evaluate(() => {
    const ve = window.videoEditor;
    const main = ve.describe().tracks.find((t) => t.main);
    ve.exec("add_color_clip", { color: "#000000", start: 7, duration: 1, track_id: main.id });
    return ve.describe().tracks.find((t) => t.main).clips.find((c) => c.start === 7)?.id ?? null;
  });
  await sw.click();
  const offState = await page.evaluate((id) => {
    const ve = window.videoEditor;
    return { cutout: ve.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).cutout, label: ve.state().undoLabel };
  }, ids.clip);
  const offPx = await page.evaluate((pts) => window.__px(90, pts), BG.map((p) => visible(p, 90)).filter(Boolean));
  const t1 = Date.now();
  await sw.click();
  await page.waitForFunction((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).cutout?.enabled, ids.clip);
  const onMs = Date.now() - t1;
  const gapKept = await page.evaluate((id) => window.videoEditor.project().tracks.find((t) => t.main).clips.find((c) => c.id === id)?.start === 7 * 30, gapClip);
  const undo = await page.evaluate(async ([id, pts]) => {
    const ve = window.videoEditor;
    const cut = () => ve.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).cutout;
    const labels = [];
    // On, off, the gap clip, then the first Remove background.
    for (let i = 0; i < 4; i++) {
      labels.push(ve.state().undoLabel);
      ve.action("undo");
    }
    const gone = cut() === undefined;
    const px = await window.__px(90, pts);
    for (let i = 0; i < 4; i++) ve.action("redo");
    return { labels, gone, px, redone: cut() };
  }, [ids.clip, BG.map((p) => visible(p, 90)).filter(Boolean)]);
  details.toggle = {
    off: offState.cutout,
    offLabel: offState.label,
    offShowsBackground: offPx.every((c) => !near(c, MAGENTA, 40)),
    onMs,
    gapKept,
    undoLabels: undo.labels,
    undoGone: undo.gone,
    undoShowsBackground: undo.px.every((c) => !near(c, MAGENTA, 40)),
    redone: undo.redone,
  };
  details.toggle.ok =
    offState.cutout?.enabled === false &&
    offState.cutout.src === details.process.cutout.src &&
    details.toggle.offShowsBackground &&
    onMs < 1500 &&
    gapKept &&
    undo.labels.join("|") === "Remove background|Remove background off|add color clip|Remove background" &&
    undo.gone &&
    details.toggle.undoShowsBackground &&
    undo.redone?.enabled === true &&
    undo.redone?.src === details.process.cutout.src;

  // ---- 5. playback cost -----------------------------------------------------------
  const play = async () =>
    page.evaluate(async () => {
      const ve = window.videoEditor;
      const { player } = await import("/src/engine/player.ts");
      ve.seek(0);
      await ve.rendered();
      const t = performance.now();
      ve.action("playPause");
      await new Promise((r) => {
        const iv = setInterval(() => {
          if (!ve.state().playing) {
            clearInterval(iv);
            r();
          }
        }, 50);
      });
      // The player resets its counter when play starts.
      return { seconds: +((performance.now() - t) / 1000).toFixed(2), dropped: player.drawn.dropped };
    });
  const setOn = (on) => page.evaluate(([id, on]) => window.videoEditor.exec("set_background_removal", { clip_ids: [id], enabled: on }), [ids.clip, on]);
  await setOn(false);
  const plain = [await play(), await play()];
  await setOn(true);
  const matted = [await play(), await play()];
  const dropped = (runs) => runs.reduce((a, r) => a + r.dropped, 0);
  details.playback = { without: plain, with: matted };
  // Two frames of slack per run for scheduling noise.
  details.playback.ok = dropped(matted) <= dropped(plain) + 4;

  // ---- 6. the AI tools card, and canceling ------------------------------------
  await page.getByRole("tab", { name: "AI tools" }).click();
  await page.waitForTimeout(400);
  await page.locator(".library-panel").screenshot({ path: path.join(shots, "bg-removal-ai-tools.png") });
  await page.evaluate(async (base) => {
    const ve = window.videoEditor;
    const [b] = await ve.import([{ name: "talk-gaps.mp4", src: `${base}/fixtures/media/talk-gaps.mp4` }]);
    ve.exec("add_media_clip", { asset_id: b.id, start: 6, duration: 4 });
    const clip = ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.asset === b.id);
    ve.select([clip.id]);
    window.__cancelClip = clip.id;
    window.__cancelRun = ve.ai.removeBackground(clip.id).then(() => "finished", (e) => e.name ?? String(e));
  }, base);
  // The card while it works, then its cancel button.
  await page.locator(".ai-cutout .ai-cancel").waitFor();
  await page.waitForFunction(() => /Removing the background of talk-gaps/.test(document.querySelector(".ai-cutout .ai-card-text p")?.textContent ?? ""));
  await page.locator(".ai-cutout").scrollIntoViewIfNeeded();
  await page.locator(".ai-cutout").screenshot({ path: path.join(shots, "bg-removal-ai-card.png") });
  const stage = await page.locator(".ai-cutout .ai-card-text p").textContent();
  await page.locator(".ai-cutout .ai-cancel").click();
  const cancel = await page.evaluate(async () => {
    const outcome = await window.__cancelRun;
    const after = window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === window.__cancelClip);
    return { outcome, cutout: after.cutout ?? null, toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent) };
  });
  cancel.stage = stage;
  details.cancel = { ...cancel, ok: cancel.outcome === "AbortError" && cancel.cutout === null && /Removing the background of talk-gaps/.test(cancel.stage) };

  // ---- 7. save, reload, reopen ---------------------------------------------------
  const projectId = await page.evaluate(() => window.videoEditor.project().id);
  await page.evaluate(() => window.videoEditor.action("saveProject"));
  await page.waitForFunction(async (src) => {
    try {
      const root = await navigator.storage.getDirectory();
      const p = window.videoEditor.project();
      const stored = JSON.parse(await (await (await (await root.getDirectoryHandle("projects")).getFileHandle(`${p.id}.json`)).getFile()).text());
      const media = await root.getDirectoryHandle("media");
      const matte = await (await media.getFileHandle(src)).getFile();
      return matte.size > 0 && stored.tracks.some((t) => t.clips.some((c) => c.cutout?.src === src && c.cutout.enabled));
    } catch {
      return false;
    }
  }, details.process.cutout.src);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".project-card").first().click();
  await page.waitForFunction((id) => window.videoEditor.project().id === id, projectId);
  await page.waitForSelector(".timeline-panel");
  const reopened = await page.evaluate(async ([pts]) => {
    window.__px = async (frame, points) => {
      const ve = window.videoEditor;
      ve.seek(frame);
      await new Promise((r) => setTimeout(r, 30));
      await ve.rendered();
      const { width, height, data } = ve.pixels();
      return points.map(([x, y]) => {
        const cx = Math.round((x * width) / 960), cy = Math.round((y * height) / 540);
        return [0, 1, 2].map((c) => data[(cy * width + cx) * 4 + c]);
      });
    };
    return window.__px(90, pts);
  }, [[...FG.map((p) => visible(p, 90)).filter(Boolean), ...BG.map((p) => visible(p, 90)).filter(Boolean)]]);
  details.persist = {
    projectId,
    cutout: await clipCutout(ids.clip),
    bgMagenta: reopened.slice(fgN).filter((c) => near(c, MAGENTA, 20)).length,
    bgPoints: reopened.length - fgN,
    fgKept: reopened.slice(0, fgN).filter((c, i) => near(c, after[90].fg[i], 24)).length,
    fgPoints: fgN,
  };
  details.persist.ok = details.persist.cutout?.src === details.process.cutout.src && details.persist.bgMagenta === details.persist.bgPoints && details.persist.fgKept === details.persist.fgPoints;

  // ---- 8. both models on the same points ------------------------------------------
  const models = await page.evaluate(async ([assetId, FG, BG, FRAMES]) => {
    const { makeMatte, MATTE_MODELS } = await import("/src/engine/cutout.ts");
    // A bare "mediabunny" does not resolve here; take the URL Vite gave it.
    const served = await (await fetch("/src/engine/cutout.ts")).text();
    const { ALL_FORMATS, BufferSource, CanvasSink, Input } = await import(served.match(/from\s+"([^"]*mediabunny[^"]*)"/)[1]);
    const asset = window.videoEditor.project().assets.find((a) => a.id === assetId);
    const score = async (bytes) => {
      const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
      const sink = new CanvasSink(await input.getPrimaryVideoTrack(), { width: 960, height: 540, fit: "fill" });
      let fgOk = 0, fgN = 0, bgOk = 0, bgN = 0;
      for (const n of FRAMES) {
        const wc = await sink.getCanvas(n / 30 + 0.01);
        const g = wc.canvas.getContext("2d");
        const at = ([sx, sy]) => {
          const x = sx - 255 + n, y = sy - 135;
          return x >= 14 && x <= 946 && y >= 14 && y <= 526 ? g.getImageData(x, y, 1, 1).data[0] : null;
        };
        for (const p of FG) {
          const v = at(p);
          if (v !== null) (fgN++, v > 200 && fgOk++);
        }
        for (const p of BG) {
          const v = at(p);
          if (v !== null) (bgN++, v < 40 && bgOk++);
        }
      }
      input.dispose();
      return { fg: `${fgOk}/${fgN}`, bg: `${bgOk}/${bgN}`, fgOk, fgN, bgOk, bgN };
    };
    const out = {};
    for (const [name, opts] of [["ormbg", {}], ["selfie-wasm", { model: MATTE_MODELS.fallback, device: "wasm" }]]) {
      const t = performance.now();
      const m = await makeMatte(asset, 0, 6, () => {}, undefined, opts);
      out[name] = {
        model: m.model, device: m.device, frames: m.frames, fps: +m.fps.toFixed(1), seconds: +((performance.now() - t) / 1000).toFixed(2),
        size: `${m.width}x${m.height}`, kb: Math.round(m.bytes.length / 1024), mbPerMinute: +((m.bytes.length / 2 ** 20) * (60 / 6)).toFixed(1),
        ...(await score(m.bytes)),
      };
    }
    return out;
  }, [ids.asset, FG, BG, FRAMES]);
  details.models = {
    ...models,
    ok: models.ormbg.fgOk === models.ormbg.fgN && models.ormbg.bgOk === models.ormbg.bgN && models["selfie-wasm"].device === "wasm" && models["selfie-wasm"].frames === 180,
  };

  // ---- 9. a job belongs to its project ----------------------------------------------
  // Opening another project mid-matte cancels it; nothing lands in the new one.
  await page.evaluate(() => {
    const ve = window.videoEditor;
    const clip = ve.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "video" && !c.cutout);
    window.__sessionJob = ve.ai.removeBackground(clip.id).then(() => "finished", (e) => e.name ?? String(e));
  });
  await page.waitForFunction(() => /Removing the background/.test(document.body.textContent));
  const oldId = await page.evaluate(() => window.videoEditor.project().id);
  await page.evaluate(() => window.videoEditor.action("newProject"));
  await page.waitForFunction((id) => window.videoEditor.project().id !== id, oldId);
  const fresh = await page.evaluate(() => JSON.stringify(window.videoEditor.project()));
  const sessionOutcome = await page.evaluate(() => window.__sessionJob);
  await page.waitForTimeout(300);
  details.session = { outcome: sessionOutcome, untouched: fresh === (await page.evaluate(() => JSON.stringify(window.videoEditor.project()))) };
  details.session.ok = details.session.outcome === "AbortError" && details.session.untouched;

  const ok = Object.values(details).every((d) => d.ok);
  return { ok, details };
}
