// Delayed real entry points must not mutate a later document session.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const next = async () => {
    const old = await page.evaluate(() => window.videoEditor.project().id);
    await page.evaluate(() => window.videoEditor.action("newProject"));
    await page.waitForFunction((id) => window.videoEditor.project().id !== id, old);
  };
  const snapshot = () => page.evaluate(() => JSON.stringify(window.videoEditor.project()));
  const unchanged = async (before) => before === await snapshot();
  await page.evaluate(async () => {
    window.__platform = (await import("/src/platform/index.ts")).platform;
    window.__media = await import("/src/state/media.ts");
    const original = window.__platform.sourceFor;
    window.__platform.sourceFor = async (...args) => {
      if (window.__delaySource) {
        window.__delaySource = false;
        await new Promise((resolve) => { window.__release = resolve; });
      }
      return original(...args);
    };
    window.__delaySource = true;
    window.__job = window.videoEditor.import([{ name: "late.mp4", src: `${location.origin}/fixtures/media/framecode-30.mp4` }]);
  });
  await page.waitForFunction(() => !!window.__release);
  await next();
  let before = await snapshot();
  const imported = await page.evaluate(async () => { window.__release(); return await window.__job; });
  details.lateMediaDiscarded = { ok: imported.length === 0 && await unchanged(before) };

  // The late import above was discarded, so the project is still untouched;
  // leaving would discard it too (ADR-073). One edit keeps it on Home.
  const current = await page.evaluate(() => {
    window.videoEditor.exec("set_project", { name: "Jobs drive" });
    return window.videoEditor.project().id;
  });
  await page.evaluate(() => {
    window.__platform.pickMedia = () => new Promise((resolve) => { window.__picked = resolve; });
    window.__job = window.__media.pickAndImport();
    window.videoEditor.action("openProject");
  });
  await page.locator(".project-card").first().click();
  await page.waitForFunction((id) => !!document.querySelector(".timeline-panel") && window.videoEditor.project().id === id, current);
  before = await snapshot();
  await page.evaluate(async () => { window.__picked([{ name: "late.mp4", src: `${location.origin}/fixtures/media/framecode-30.mp4`, size: 1 }]); await window.__job; });
  details.sameProjectReopenInvalidatesPicker = { ok: await unchanged(before) };

  await page.evaluate(async () => {
    const { importCaptions } = await import("/src/state/captions.ts");
    window.__job = importCaptions({ name: "late.srt", text: () => new Promise((resolve) => { window.__caption = resolve; }) });
  });
  await next();
  before = await snapshot();
  await page.evaluate(async () => { window.__caption("1\n00:00:00,000 --> 00:00:02,000\nLate caption\n"); await window.__job; });
  details.lateSubtitlesDiscarded = { ok: await unchanged(before) };

  await page.evaluate(async () => {
    const { importLuts } = await import("/src/state/luts.ts");
    const original = window.__platform.blobFor;
    window.__platform.blobFor = async (...args) => {
      if (args[0] === "late.cube") return new Promise((resolve) => { window.__lut = resolve; });
      return original(...args);
    };
    window.__job = importLuts([{ name: "late.cube", src: "late.cube" }]);
  });
  await next();
  before = await snapshot();
  await page.evaluate(async () => { window.__lut(new Blob(["LUT_1D_SIZE 2\n0 0 0\n1 1 1\n"])); await window.__job; });
  details.lateLutDiscarded = { ok: await unchanged(before) };

  await page.evaluate(async () => {
    const v = window.videoEditor;
    const [asset] = await v.import([{ name: "beat-128.m4a", src: `${location.origin}/fixtures/media/beat-128.m4a` }]);
    v.exec("add_media_clip", { asset_id: asset.id, start: 0 });
    const clip = v.project().tracks.flatMap((t) => t.clips).find((c) => c.assetId === asset.id);
    // Hold the first media open for analysis; probing already completed.
    window.__delaySource = true;
    window.__release = null;
    window.__job = v.ai.markBeats(clip.id).then(() => "applied", (e) => e.name);
  });
  await page.waitForFunction(() => !!window.__release);
  await next();
  before = await snapshot();
  const analysis = await page.evaluate(async () => { window.__release(); return await window.__job; });
  details.lateAnalysisCanceled = { ok: analysis === "AbortError" && await unchanged(before) };
  await page.evaluate(() => {
    const original = window.__platform.adoptFiles;
    window.__platform.adoptFiles = async (...args) => {
      await new Promise((resolve) => { window.__sticker = resolve; });
      return original(...args);
    };
    window.__job = window.videoEditor.exec("add_sticker", { name: window.videoEditor.stickers()[0].id }).then(() => "applied", (e) => e.name);
  });
  await page.waitForFunction(() => !!window.__sticker);
  await next();
  before = await snapshot();
  const sticker = await page.evaluate(async () => { window.__sticker(); return await window.__job; });
  details.lateStickerDiscarded = { ok: sticker === "AbortError" && await unchanged(before) };
  let heldWorker;
  // Captions load no model for a timeline without sound (ADR-144): give it speech.
  await page.evaluate(async () => {
    const [speech] = await window.videoEditor.import([{ name: "speech.wav", src: `${location.origin}/fixtures/media/speech-test.wav` }]);
    window.videoEditor.exec("add_media_clip", { asset_id: speech.id, start: 0 });
  });
  await page.route("**/asr.worker.ts*", (route) => { heldWorker = route; });
  const loading = page.waitForRequest("**/asr.worker.ts*");
  await page.evaluate(async () => {
    const { generateCaptions } = await import("/src/state/captions.ts");
    window.__job = generateCaptions({ model: "onnx-community/whisper-tiny.en_timestamped", language: null, replace: true });
  });
  await loading;
  await next();
  before = await snapshot();
  await heldWorker.abort().catch(() => {});
  await page.unroute("**/asr.worker.ts*");
  await page.evaluate(() => window.__job);
  details.captionGenerationCanceled = { ok: await unchanged(before) };
  await page.evaluate(async () => {
    const [asset] = await window.videoEditor.import([{ name: "normal.mp4", src: `${location.origin}/fixtures/media/framecode-30.mp4` }]);
    window.videoEditor.exec("add_media_clip", { asset_id: asset.id, start: 0 });
  });
  details.newSessionWorks = { ok: await page.evaluate(() => window.videoEditor.project().assets.length === 1 && window.videoEditor.project().tracks.some((t) => t.clips.length === 1)) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
