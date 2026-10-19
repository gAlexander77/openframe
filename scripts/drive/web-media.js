// Web build, projects and media (ADR-073). Media imported by its address
// is copied into the browser's storage as a picked file is, so the project
// still plays when the address is gone; and pressing Create and leaving at
// once keeps no empty project on Home, while a touched one is kept.
async (page) => {
  page.setDefaultTimeout(8000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  const details = {};
  const cards = () => page.locator(".project-card").count();
  const back = async () => {
    await page.locator(".menubar-item > button", { hasText: "File" }).click();
    await page.getByRole("menuitem", { name: "Back to home" }).click();
    await page.locator(".create-card").waitFor();
    await page.waitForTimeout(300);
  };

  // Create and leave at once: nothing kept.
  const before = await cards();
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const listed = await page.evaluate(async () => (await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_projects", arguments: {} } })).result.content[0].text);
  details.listedWhileOpen = { ok: /"open":true/.test(listed) };
  await back();
  details.emptyNotKept = { ok: (await cards()) === before, before, after: await cards() };

  // A URL import is copied; the project plays with the address gone.
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const url = `${new URL(page.url()).origin}/fixtures/media/photo.png`;
  const asset = await page.evaluate(async (url) => {
    const ve = window.videoEditor;
    ve.exec("set_project", { name: "URL import kept" });
    const [a] = await ve.import([{ name: "photo.png", src: url }]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0, duration: 2 });
    return ve.project().assets.find((x) => x.id === a.id);
  }, url);
  const stored = await page.evaluate(async (src) => {
    try {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("media");
      return (await (await dir.getFileHandle(src)).getFile()).size;
    } catch {
      return 0;
    }
  }, asset.src);
  details.copied = { ok: !/^https?:/.test(asset.src) && stored > 100000 && stored === asset.size, src: asset.src.replace(/^[0-9a-f]{8}-/, "…-"), stored };
  await page.waitForFunction(() => /Saved/.test(document.querySelector(".save-state")?.textContent ?? ""), null, { timeout: 8000 }).catch(() => undefined);
  await back();
  details.touchedKept = { ok: (await cards()) === before + 1 };
  // The address goes offline; the project, reopened after a reload, still shows the picture.
  await page.context().route(url, (r) => r.abort());
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".project-card", { hasText: "URL import kept" }).click();
  await page.locator(".timeline-panel").waitFor();
  const lit = await page.evaluate(async () => {
    const ve = window.videoEditor;
    ve.seek(10);
    await new Promise((r) => setTimeout(r, 500));
    await ve.rendered();
    const px = ve.pixels(64);
    let sum = 0;
    for (let i = 0; i < px.data.length; i += 4) sum += px.data[i] + px.data[i + 1] + px.data[i + 2];
    return sum / (px.data.length / 4) / 3;
  });
  details.playsOffline = { ok: lit > 20, meanLevel: Math.round(lit) };
  await page.context().unroute(url);
  return { ok: Object.values(details).every((d) => d.ok), details };
};
