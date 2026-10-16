async page => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload(); await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click(); await page.locator(".timeline-panel").waitFor();
  await page.locator(".project-name").click(); await page.locator(".project-name-input").fill("__QA_20261016_trim"); await page.locator(".project-name-input").press("Enter");
  const ids = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [a] = await api.import([{ name: "framecode-30.mp4", src: (window.videoEditor.platform() === "desktop" ? "F:/Dev/video-editor" : location.origin) + "/fixtures/media/framecode-30.mp4" }]);
    api.exec("add_media_clip", { asset_id: a.id, start: 0, in: 1, duration: 2 });
    api.exec("add_media_clip", { asset_id: a.id, start: 2, in: 4, duration: 2 });
    api.exec("add_media_clip", { asset_id: a.id, start: 4, in: 7, duration: 2 });
    if (api.state().snapping) api.action("toggleSnapping");
    window.__trimBefore = JSON.stringify(api.project().tracks);
    return api.project().tracks[0].clips.map((c) => c.id);
  });
  const details = {};
  const drag = async (id, edge, dx) => {
    const el = page.locator(`[data-clip="${id}"]${edge ? ` .trim-${edge}` : ""}`);
    const b = await el.boundingBox(); const x = b.x + b.width / 2, y = b.y + (edge ? b.height / 2 : 25);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 5 });
    await page.getByRole("region", { name: "Trim preview", exact: true }).waitFor();
  };
  const framesMatch = async () => {
    await page.waitForFunction(() => [...document.querySelectorAll(".trim-pair figure")].every((figure) => {
      const canvas = figure.querySelector("canvas"); if (!canvas?.dataset.frame) return false;
      const gl = canvas.getContext("webgl2"); const data = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      let n = 0;
      for (let i = 0; i < 10; i++) if (data[(Math.floor(canvas.height / 2) * canvas.width + Math.floor((i + 0.5) * canvas.width / 10)) * 4] > 128) n |= 1 << i;
      return n === Math.floor(+figure.dataset.sourceTime * 30 + 1e-6);
    }));
  };
  await page.evaluate(() => window.videoEditor.action("toolRoll"));
  await drag(ids[0], "end", 60); await framesMatch();
  details.rollPixels = { ok: await page.locator(".trim-pair figcaption").allTextContents().then((texts) => texts.join("|") === "Outgoing · Last frame|Incoming · First frame") };
  await page.screenshot({ path: "scratch/trim-roll-desktop.png", animations: "disabled" });
  await page.mouse.up();
  details.commitsAndCloses = { ok: await page.locator(".trim-preview").count() === 0 && await page.evaluate(() => window.videoEditor.state().undoLabel === "Roll edit") };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.oneUndoRestores = { ok: await page.evaluate(() => JSON.stringify(window.videoEditor.project().tracks) === window.__trimBefore) };
  await page.evaluate(() => window.videoEditor.action("toolSlip"));
  await drag(ids[0], null, -40); await framesMatch();
  details.slipPixels = { ok: await page.locator(".trim-pair figcaption").allTextContents().then((texts) => texts.join("|") === "First frame|Last frame") };
  await page.keyboard.press("Escape"); await page.mouse.up();
  details.escapeRestores = { ok: await page.locator(".trim-preview").count() === 0 && await page.evaluate(() => JSON.stringify(window.videoEditor.project().tracks) === window.__trimBefore) };
  await page.evaluate(() => window.videoEditor.action("toolSlide"));
  await drag(ids[1], null, 40); await framesMatch();
  details.slideNeighbors = { ok: await page.locator(".trim-pair figcaption").allTextContents().then((texts) => texts.join("|") === "Previous · Last frame|Next · First frame") };
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel"))); await page.mouse.up();
  details.pointerCancelRestores = { ok: await page.locator(".trim-preview").count() === 0 && await page.evaluate(() => JSON.stringify(window.videoEditor.project().tracks) === window.__trimBefore) };
  await page.setViewportSize({ width: 1100, height: 680 });
  await page.evaluate(() => window.videoEditor.action("toolSelect"));
  await drag(ids[0], "end", -40); await framesMatch();
  details.narrowFit = { ok: await page.locator(".trim-preview").evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().bottom <= innerHeight) };
  await page.screenshot({ path: "scratch/trim-narrow-desktop.png", animations: "disabled" });
  await page.keyboard.press("Escape"); await page.mouse.up();
  return { ok: Object.values(details).every((d) => d.ok), details };
};
