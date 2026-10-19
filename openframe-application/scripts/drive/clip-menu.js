// The fuller clip menu: Ripple delete, Split, Speed (the inspector's Speed
// tab), Reverse (a check that toggles), Copy and Paste effects, Rename,
// Ungroup and Duplicate, each running the action or command the rest of
// the app uses. The same edits through MCP (set_reverse, copy_effects).
// A long menu stays inside a short window and scrolls.
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
    return { a, b };
  });
  const clip = (id) => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id) ?? null, id);
  const clips = () => page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips));
  const menuOn = async (id) => {
    await page.keyboard.press("Escape");
    await page.locator(`[data-clip="${id}"]`).click({ button: "right", position: { x: 60, y: 34 } });
    return page.locator(".timeline-panel .menu");
  };
  // By the label alone: a menu item's name also holds its keys.
  const item = (name) => page.locator(".timeline-panel .menu .menu-item").filter({ has: page.locator(".menu-label").getByText(name, { exact: true }) });
  const details = {};

  let menu = await menuOn(ids.a);
  const labels = await menu.locator(".menu-label").allTextContents();
  const want = ["Ripple delete", "Split", "Speed…", "Reverse", "Copy effects", "Paste effects", "Rename…", "Ungroup clips", "Duplicate"];
  details.items = { ok: want.every((w) => labels.includes(w)), missing: want.filter((w) => !labels.includes(w)) };
  details.disabledRight = { ok: (await item("Paste effects").isDisabled()) && (await item("Copy effects").isDisabled()) && (await item("Ungroup clips").isDisabled()) };
  await page.waitForTimeout(400); // the menu fades in
  await page.screenshot({ path: "scratch/clip-menu.png" });

  // Reverse toggles, and shows its state.
  await item("Reverse").click();
  details.reverse = { ok: (await clip(ids.a)).reverse === true };
  menu = await menuOn(ids.a);
  details.reverseChecked = { ok: (await item("Reverse").locator(".menu-check svg").count()) === 1 };
  await item("Reverse").click();
  details.forward = { ok: !(await clip(ids.a)).reverse };

  // Speed opens the inspector's Speed tab.
  menu = await menuOn(ids.a);
  await item("Speed…").click();
  details.speedTab = { ok: (await page.locator(".insp-tabs [role=tab][aria-selected=true]").textContent()) === "Speed" };

  // Copy effects from one clip, paste onto the other.
  await page.evaluate((id) => window.videoEditor.exec("add_effect", { clip_id: id, type: "glow" }), ids.a);
  menu = await menuOn(ids.a);
  await item("Copy effects").click();
  menu = await menuOn(ids.b);
  await item("Paste effects").click();
  details.pasteEffects = { ok: (await clip(ids.b)).effects.map((e) => e.type).join() === "glow" };

  // Ungroup is offered once the clip is grouped.
  await page.evaluate((ids) => window.videoEditor.exec("group_clips", { clip_ids: [ids.a, ids.b] }), ids);
  menu = await menuOn(ids.a);
  await item("Ungroup clips").click();
  details.ungroup = { ok: !(await clip(ids.a)).group && !(await clip(ids.b)).group };

  // Split at the playhead, then Duplicate and Ripple delete.
  await page.evaluate(() => window.videoEditor.seek(120));
  menu = await menuOn(ids.b);
  await item("Split").click();
  details.split = { ok: (await clips()).length === 3 };
  menu = await menuOn(ids.a);
  await item("Duplicate").click();
  details.duplicate = { ok: (await clips()).length === 4 };
  const before = await clips();
  menu = await menuOn(ids.a);
  await item("Ripple delete").click();
  const after = await clips();
  details.rippleDelete = { ok: after.length === 3 && !after.some((c) => c.id === ids.a) && Math.min(...after.map((c) => c.start)) === 0, before: before.length };

  // Agents: the same commands over MCP.
  const call = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const r = await call("set_reverse", { clip_id: ids.b, reverse: true });
  details.mcpReverse = { ok: !r.result?.isError && (await clip(ids.b)).reverse === true };

  // A short window: the menu stays inside it and scrolls.
  await page.setViewportSize({ width: 1100, height: 680 });
  menu = await menuOn(ids.b);
  const box = await menu.boundingBox();
  const scrolls = await menu.evaluate((el) => el.scrollHeight > el.clientHeight);
  details.fits = { ok: box.y >= 0 && box.y + box.height <= 680, box, scrolls };
  await page.waitForTimeout(400);
  await page.screenshot({ path: "scratch/clip-menu-short.png" });
  await page.keyboard.press("Escape");
  return { ok: Object.values(details).every((d) => d.ok), details };
};
