async page => {
  await page.reload(); await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click(); await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => window.videoEditor.exec("set_project", { name: "__QA_20261016_jobs_source" }));
  const details = {};
  await page.evaluate(async () => {
    const url = (path) => performance.getEntriesByType("resource").find((e) => new URL(e.name).pathname === path).name;
    window.__jobPlatform = (await import(url("/src/platform/index.ts"))).platform;
    window.__jobMedia = await import(url("/src/state/media.ts"));
    const source = window.__jobPlatform.sourceFor;
    window.__jobPlatform.sourceFor = async (...args) => {
      if (window.__holdSource) { window.__holdSource = false; await new Promise((r) => { window.__releaseSource = r; }); }
      return source(...args);
    };
    window.__holdSource = true;
    window.__pendingJob = window.videoEditor.import([{ name: "framecode-30.mp4", src: "__REPO__/fixtures/media/framecode-30.mp4" }]);
  });
  await page.waitForFunction(() => !!window.__releaseSource);
  const old = await page.evaluate(() => window.videoEditor.project().id);
  await page.evaluate(() => window.videoEditor.action("newProject"));
  await page.waitForFunction((id) => window.videoEditor.project().id !== id, old);
  await page.evaluate(() => window.videoEditor.exec("set_project", { name: "__QA_20261016_jobs_target" }));
  const before = await page.evaluate(() => JSON.stringify(window.videoEditor.project()));
  details.importDoesNotCross = { ok: await page.evaluate(async (before) => { window.__releaseSource(); const added = await window.__pendingJob; return added.length === 0 && JSON.stringify(window.videoEditor.project()) === before; }, before) };
  const current = await page.evaluate(() => window.videoEditor.project().id);
  await page.evaluate(() => {
    window.__jobPlatform.pickMedia = () => new Promise((r) => { window.__releasePicker = r; });
    window.__pendingJob = window.__jobMedia.pickAndImport();
    window.videoEditor.action("openProject");
  });
  await page.locator(".create-card").waitFor();
  await page.locator(".home-search input").fill("__QA_20261016_jobs_target");
  await page.locator(".project-card").first().click();
  await page.waitForFunction((id) => !!document.querySelector(".timeline-panel") && window.videoEditor.project().id === id, current);
  details.sameIdReopenInvalidates = { ok: await page.evaluate(async () => {
    const before = JSON.stringify(window.videoEditor.project());
    window.__releasePicker([{ name: "framecode-30.mp4", src: "__REPO__/fixtures/media/framecode-30.mp4" }]);
    await window.__pendingJob;
    return before === JSON.stringify(window.videoEditor.project());
  }) };
  await page.evaluate(async () => {
    const [a] = await window.videoEditor.import([{ name: "beat-128.m4a", src: "__REPO__/fixtures/media/beat-128.m4a" }]);
    window.videoEditor.exec("add_media_clip", { asset_id: a.id, start: 0 });
    const c = window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.assetId === a.id);
    window.__holdSource = true; window.__releaseSource = null;
    window.__pendingJob = window.videoEditor.ai.markBeats(c.id).then(() => "applied", (e) => e.name);
  });
  await page.waitForFunction(() => !!window.__releaseSource);
  await page.evaluate(() => window.videoEditor.action("newProject"));
  await page.waitForFunction((id) => window.videoEditor.project().id !== id, current);
  await page.evaluate(() => window.videoEditor.exec("set_project", { name: "__QA_20261016_jobs_final" }));
  details.analysisCanceled = { ok: await page.evaluate(async () => { const before = JSON.stringify(window.videoEditor.project()); window.__releaseSource(); const result = await window.__pendingJob; return result === "AbortError" && before === JSON.stringify(window.videoEditor.project()); }) };
  await page.evaluate(async () => { const [a] = await window.videoEditor.import([{ name: "framecode-30.mp4", src: "__REPO__/fixtures/media/framecode-30.mp4" }]); window.videoEditor.exec("add_media_clip", { asset_id: a.id, start: 0, duration: 1 }); });
  details.newSessionWorks = { ok: await page.evaluate(() => window.videoEditor.project().assets.length === 1 && window.videoEditor.project().tracks.some((t) => t.clips.length === 1)) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
