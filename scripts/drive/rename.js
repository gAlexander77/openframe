// Rename clips and media: the clip menu's Rename, a double-click on a
// clip's name, the media card's Rename and a double-click on its name
// (which must not add it to the timeline), then rename_clip and
// rename_media over MCP. Each rename is one undo step.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [fc] = await api.import([{ name: "framecode-30.mp4", src: location.origin + "/fixtures/media/framecode-30.mp4" }]);
    api.exec("add_media_clip", { asset_id: fc.id, start: 0, duration: 3 });
    api.exec("add_media_clip", { asset_id: fc.id, start: 3, duration: 3 });
    const [a, b] = api.project().tracks.find((t) => t.main).clips.map((c) => c.id);
    return { asset: fc.id, a, b };
  });
  const clipName = (id) => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id)?.name ?? null, id);
  const assetName = () => page.evaluate((id) => window.videoEditor.project().assets.find((a) => a.id === id)?.name, ids.asset);
  const clipCount = () => page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).length);
  const details = {};

  // Clip menu > Rename: the name strip becomes a field; Enter keeps it.
  await page.locator(`[data-clip="${ids.a}"]`).click({ button: "right", position: { x: 40, y: 30 } });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const field = page.locator(`[data-clip="${ids.a}"] .clip-rename`);
  await field.waitFor();
  await field.fill("Opening shot");
  await page.locator(".timeline-panel").screenshot({ path: "scratch/rename-clip-field.png" });
  await field.press("Enter");
  details.menuRename = { ok: (await clipName(ids.a)) === "Opening shot", name: await clipName(ids.a) };
  details.shown = { ok: (await page.locator(`[data-clip="${ids.a}"] .clip-name`).textContent()) === "Opening shot" };
  details.undoLabel = { ok: (await page.getByRole("button", { name: "Undo Rename clip", exact: true }).count()) === 1 };

  // Double-click the second clip's name; Escape keeps the old name.
  await page.locator(`[data-clip="${ids.b}"] .clip-name`).dblclick();
  await page.locator(`[data-clip="${ids.b}"] .clip-rename`).fill("Not this");
  await page.locator(`[data-clip="${ids.b}"] .clip-rename`).press("Escape");
  details.escapeKeeps = { ok: (await clipName(ids.b)) === null };
  await page.locator(`[data-clip="${ids.b}"] .clip-name`).dblclick();
  await page.locator(`[data-clip="${ids.b}"] .clip-rename`).fill("Closing shot");
  await page.locator(`[data-clip="${ids.b}"] .clip-rename`).press("Enter");
  details.doubleClick = { ok: (await clipName(ids.b)) === "Closing shot" };

  // Media card: menu Rename, then a double-click on the name.
  const card = page.locator(".media-card").first();
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.locator(".card-rename").fill("Countdown");
  await page.locator(".media-browser").screenshot({ path: "scratch/rename-card-field.png" });
  await page.locator(".card-rename").press("Enter");
  details.mediaMenu = { ok: (await assetName()) === "Countdown", name: await assetName() };
  const before = await clipCount();
  await card.locator(".card-label").dblclick();
  await page.locator(".card-rename").fill("Framecode countdown");
  await page.locator(".card-rename").press("Enter");
  details.mediaDoubleClick = { ok: (await assetName()) === "Framecode countdown" && (await clipCount()) === before, clips: await clipCount() };

  // Undo takes back one rename at a time.
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undo = { ok: (await assetName()) === "Countdown" };
  await page.screenshot({ path: "scratch/rename.png" });

  // MCP: rename_clip (an empty name clears it) and rename_media.
  const call = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const r1 = await call("rename_clip", { clip_ids: [ids.a], name: "" });
  details.mcpClear = { ok: !r1.result?.isError && (await clipName(ids.a)) === null, text: r1.result?.content?.[0]?.text?.slice(0, 200) };
  const r2 = await call("rename_media", { asset_id: ids.asset, name: "Count" });
  details.mcpMedia = { ok: !r2.result?.isError && (await assetName()) === "Count" };
  details.clipFollowsMedia = { ok: (await page.locator(`[data-clip="${ids.a}"] .clip-name`).textContent()) === "Count" };
  const r3 = await call("rename_media", { asset_id: ids.asset, name: "   " });
  details.mcpRefuses = { ok: r3.result?.isError === true, text: r3.result?.content?.[0]?.text };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
