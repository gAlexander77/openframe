// Activate / deactivate clip (CapCut's, Premiere's Enable; set_clip_enabled
// for agents, ADR-101), as a person uses it (ADR-109):
// - the clip menu names what it will do to the whole selection, and does
//   that: a mixed selection goes off together (each clip used to flip, so
//   "Activate clip" on an off clip turned the other one off), and comes back
//   on together when every one is off, from the menu or the V key;
// - the undo step says which it was ("Activate clip" read "Deactivate
//   clip"), a clip turned back on keeps no `disabled: false`, and an off
//   clip is hatched and says "deactivated" to a screen reader;
// - an agent's set_clip_enabled is announced in the same words.
async (page) => {
  page.setDefaultTimeout(6000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").first().click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  const ids = await page.evaluate(() => {
    const ve = window.videoEditor;
    ve.exec("add_text", { text: "Title", start: 0, duration: 3 });
    ve.exec("add_color_clip", { color: "#336699", start: 0, duration: 3 });
    const clips = ve.project().tracks.flatMap((t) => t.clips);
    return { title: clips.find((c) => c.type === "text").id, shape: clips.find((c) => c.type === "color").id };
  });
  const clip = (id) => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id), id);
  const undo = () => page.evaluate(() => window.videoEditor.state().undoLabel);
  const el = (id) => page.locator(`[data-clip="${id}"]`);
  const menuItem = () => page.locator(".timeline-panel .menu .menu-item").filter({ has: page.locator(".menu-label", { hasText: /activate/i }) });
  const menuOn = async (id) => {
    await el(id).click({ button: "right", position: { x: 40, y: 10 } });
    await page.waitForTimeout(300);
    return (await menuItem().locator(".menu-label").textContent()).trim();
  };

  // One clip: off, then on, from the menu.
  let label = await menuOn(ids.title);
  await menuItem().click();
  await page.waitForTimeout(200);
  let t = await clip(ids.title);
  check("the menu deactivates a clip", label === "Deactivate clip" && t.disabled === true && (await undo()) === "Deactivate clip", { label, undo: await undo() });
  const aria = await el(ids.title).getAttribute("aria-label");
  check("an off clip is hatched and says so", /deactivated/.test(aria) && (await el(ids.title).evaluate((e) => e.classList.contains("disabled"))), { aria });
  await page.screenshot({ path: "scratch/drive-shots/clip-enable-off.png" });
  label = await menuOn(ids.title);
  await menuItem().click();
  await page.waitForTimeout(200);
  t = await clip(ids.title);
  check("the menu activates it again, named so in undo", label === "Activate clip" && !("disabled" in t) && (await undo()) === "Activate clip", { label, undo: await undo(), disabled: t.disabled });
  check("on again, it says nothing of it", !/deactivated/.test(await el(ids.title).getAttribute("aria-label")));

  // A mixed selection: the off title and the playing shape.
  await page.evaluate((ids) => {
    window.videoEditor.exec("set_clip_enabled", { clip_ids: [ids.title], enabled: false });
    window.videoEditor.select([ids.title, ids.shape]);
  }, ids);
  label = await menuOn(ids.title);
  await menuItem().click();
  await page.waitForTimeout(200);
  let both = [await clip(ids.title), await clip(ids.shape)];
  check("a mixed selection goes off together", label === "Deactivate 2 clips" && both.every((c) => c.disabled === true) && (await undo()) === "Deactivate 2 clips", { label, undo: await undo(), disabled: both.map((c) => c.disabled) });
  // The V key brings both back.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("v");
  await page.waitForTimeout(200);
  both = [await clip(ids.title), await clip(ids.shape)];
  check("V turns them all back on", both.every((c) => !c.disabled) && (await undo()) === "Activate 2 clips", { undo: await undo(), disabled: both.map((c) => c.disabled) });
  await page.evaluate(() => window.videoEditor.action("undo"));
  both = [await clip(ids.title), await clip(ids.shape)];
  check("undo puts them back off", both.every((c) => c.disabled === true));

  // An agent turning a clip on is announced in the timeline's words.
  await page.evaluate(async (id) => {
    await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "set_clip_enabled", arguments: { clip_ids: [id], enabled: true } } });
  }, ids.title);
  await page.waitForTimeout(200);
  const notice = await page.locator(".toasts-agent .toast").allTextContents();
  check("an agent's set_clip_enabled is announced as Activate clip", notice.some((n) => /Activate clip/.test(n)) && (await undo()) === "Activate clip", { notice, undo: await undo() });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
