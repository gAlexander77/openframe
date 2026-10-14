// Remove background drive: proves CapCut's Remove background end to end on
// a real person. The fixture (fixtures/media/person-pan.mp4, made by
// scripts/make-fixtures.mjs) is a CC0 portrait panned one pixel a frame,
// so where every point of the photo is on every frame is known: the face
// and jacket must stay, the foliage and the white column must go.
//   - processing through the inspector's Remove BG > Auto removal switch
//     completes with rising progress, as one undo step;
//   - with a magenta clip on the track below, the viewer shows magenta where
//     the photo's background was and the untouched clip where the person is;
//   - an exported still and a rendered MP4 (decoded by ffmpeg) agree;
//   - off keeps the matte, so on again is instant; undo restores;
//   - playback with the matte drops no more frames than without (measured);
//   - canceling leaves the clip as it was.
// Needs the dev server, fixtures and ffmpeg on PATH, and Node (it shells
// out), so run it from a Node Playwright script with the repo root as the
// working directory, like export.js:
//   const drive = eval(fs.readFileSync("scripts/drive/bg-removal.js", "utf8"));
//   const { ok, details } = await drive(page, { base: "http://localhost:1420" });
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

  // ---- 1. process through the inspector's switch ------------------------------
  await page.evaluate((id) => window.videoEditor.select([id]), ids.clip);
  await page.getByRole("tab", { name: "Video" }).click();
  await page.getByRole("radio", { name: "Remove BG" }).click();
  const started = Date.now();
  await page.getByRole("switch", { name: "Remove background" }).click();
  const progress = [];
  for (;;) {
    const s = await page.evaluate((id) => {
      const bar = document.querySelector(".cutout-progress");
      const c = window.videoEditor.project().tracks.flatMap((t) => t.clips).find((x) => x.id === id);
      return { pct: bar ? Number(bar.getAttribute("aria-valuenow")) : null, cutout: c.cutout ?? null, toast: document.querySelector(".toast")?.textContent ?? "" };
    }, ids.clip);
    if (s.pct !== null && progress.at(-1) !== s.pct) progress.push(s.pct);
    if (s.cutout) {
      details.process = { cutout: s.cutout };
      break;
    }
    if (/rror|couldn|can't/i.test(s.toast)) throw new Error(`processing failed: ${s.toast}`);
    if (Date.now() - started > 600_000) throw new Error("processing took over 10 minutes");
    await page.waitForTimeout(100);
  }
  const state = await page.evaluate(() => window.videoEditor.state());
  Object.assign(details.process, {
    seconds: (Date.now() - started) / 1000,
    progress: progress.filter((_, i) => i % Math.ceil(progress.length / 12) === 0 || i === progress.length - 1),
    undoLabel: state.undoLabel,
  });
  details.process.ok =
    details.process.cutout.enabled &&
    progress.length >= 3 &&
    progress.every((v, i) => i === 0 || v >= progress[i - 1]) &&
    progress.at(-1) >= 80 &&
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
  const sw = page.getByRole("switch", { name: "Remove background" });
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
  const undo = await page.evaluate(async ([id, pts]) => {
    const ve = window.videoEditor;
    const cut = () => ve.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).cutout;
    const labels = [];
    for (let i = 0; i < 3; i++) {
      labels.push(ve.state().undoLabel);
      ve.action("undo");
    }
    const gone = cut() === undefined;
    const px = await window.__px(90, pts);
    ve.action("redo");
    return { labels, gone, px, redone: cut() };
  }, [ids.clip, BG.map((p) => visible(p, 90)).filter(Boolean)]);
  details.toggle = {
    off: offState.cutout,
    offLabel: offState.label,
    offShowsBackground: offPx.every((c) => !near(c, MAGENTA, 40)),
    onMs,
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
    undo.labels.join("|") === "Remove background|Remove background off|Remove background" &&
    undo.gone &&
    details.toggle.undoShowsBackground &&
    undo.redone?.src === details.process.cutout.src;

  // ---- 5. playback cost -----------------------------------------------------------
  const play = async () =>
    page.evaluate(async () => {
      const ve = window.videoEditor;
      const { player } = await import("/src/engine/player.ts");
      ve.seek(0);
      await ve.rendered();
      let drawn = 0;
      const stop = player.onFrame(() => drawn++);
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
      stop();
      return { seconds: +((performance.now() - t) / 1000).toFixed(2), drawn, dropped: player.drawn.dropped };
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
  const cancel = await page.evaluate(async (base) => {
    const ve = window.videoEditor;
    const [b] = await ve.import([{ name: "talk-gaps.mp4", src: `${base}/fixtures/media/talk-gaps.mp4` }]);
    ve.exec("add_media_clip", { asset_id: b.id, start: 6, duration: 4 });
    const clip = ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.asset === b.id);
    ve.select([clip.id]);
    const run = ve.ai.removeBackground(clip.id).then(() => "finished", (e) => e.name ?? String(e));
    // Wait until the card shows progress, then press its cancel button.
    for (let i = 0; i < 200 && !document.querySelector(".ai-cutout .ai-cancel"); i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector(".ai-cutout .ai-cancel")?.click();
    const outcome = await run;
    const after = ve.project().tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id);
    return { outcome, cutout: after.cutout ?? null, toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent) };
  }, base);
  details.cancel = { ...cancel, ok: cancel.outcome === "AbortError" && cancel.cutout === null };

  const ok = Object.values(details).every((d) => d.ok);
  return { ok, details };
}
