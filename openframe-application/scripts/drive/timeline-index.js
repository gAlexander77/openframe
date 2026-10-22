// Timeline index: live search, keyboard reach, revealing a distant clip,
// timeline selection, kind filters and a compound's own timeline.
async (page) => {
  page.setDefaultTimeout(12000);
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").first().click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const check = (name, ok, extra = {}) => details[name] = { ok: !!ok, ...extra };
  const ids = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: "Sunrise footage", src: `${location.origin}/fixtures/media/framecode-30.mp4` }]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0, duration: 2 });
    ve.exec("add_text", { text: "Sale today\nLimited offer", start: 3, duration: 2 });
    ve.exec("add_text", { text: "Far title", start: 180, duration: 2 });
    const clips = ve.project().tracks.flatMap(t => t.clips);
    const near = clips.find(c => c.type === "text" && c.text.startsWith("Sale")).id;
    const far = clips.find(c => c.type === "text" && c.text === "Far title").id;
    ve.exec("set_clip_label", { clip_ids: [far], label: "purple" });
    return { near, far, video: clips.find(c => c.type === "video").id };
  });
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search timeline clips" });
  const rows = page.locator(".index-row");
  check("all clips", await rows.count() === 3);
  await search.fill("LIMITED OFFER");
  check("search second text line", await rows.count() === 1 && await rows.first().getAttribute("data-index-clip") === ids.near);
  await search.fill("sunrise");
  check("search media name", await rows.count() === 1 && await rows.first().getAttribute("data-index-clip") === ids.video);
  await search.fill("");
  await page.getByRole("combobox", { name: "Filter timeline clips" }).selectOption("text");
  check("titles filter", await rows.count() === 2);
  const far = page.locator(`[data-index-clip="${ids.far}"]`);
  await far.click();
  await page.waitForTimeout(100);
  const state = await page.evaluate(() => window.videoEditor.state());
  const visible = await page.locator(`[data-clip="${ids.far}"]`).evaluate(el => {
    const r = el.getBoundingClientRect(), s = el.closest(".tl-scroll").getBoundingClientRect();
    return { visible: r.left >= s.left + 120 && r.left < s.right && r.top >= s.top && r.bottom <= s.bottom, rect: r.toJSON(), view: s.toJSON() };
  });
  check("select seek and reveal", state.selection[0] === ids.far && state.playhead === 5400 && visible.visible, { state: { selection: state.selection, playhead: state.playhead }, ...visible });
  check("color label", await far.getByLabel("purple label").count() === 1);
  await page.locator(`[data-index-clip="${ids.near}"]`).focus();
  await page.keyboard.press("ArrowDown");
  check("arrow reach", await page.evaluate(id => window.videoEditor.state().selection[0] === id && document.activeElement.dataset.indexClip === id, ids.far));
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  check("enter selection", await page.evaluate(id => window.videoEditor.state().selection[0] === id, ids.near));
  await page.getByRole("combobox", { name: "Filter timeline clips" }).selectOption("all");
  await page.evaluate(id => window.videoEditor.select([id]), ids.video);
  check("timeline selection highlights row", await page.locator(`[data-index-clip="${ids.video}"]`).getAttribute("aria-pressed") === "true");
  await page.evaluate(id => window.videoEditor.exec("rename_clip", { clip_ids: [id], name: "New title" }), ids.near);
  check("updates live", (await page.locator(`[data-index-clip="${ids.near}"]`).textContent()).includes("New title"));
  const compound = await page.evaluate(ids => {
    const ve = window.videoEditor;
    ve.exec("create_compound_clip", { clip_ids: [ids.video, ids.near], name: "Ad nest" });
    return ve.project().tracks.flatMap(t => t.clips).find(c => c.type === "compound").id;
  }, ids);
  await page.locator(`[data-index-clip="${compound}"]`).dblclick();
  await page.waitForTimeout(100);
  check("compound view", await rows.count() === 2 && await page.evaluate(() => window.videoEditor.state().nest.length) === 1);
  await page.locator(`[data-index-clip="${ids.near}"]`).click();
  check("select inside compound", await page.evaluate(id => window.videoEditor.state().selection[0] === id && window.videoEditor.state().playhead === 90, ids.near));
  await page.getByRole("button", { name: "Back out of the compound clip" }).click();
  check("return to root", await rows.count() === 2);
  await page.locator(".timeline-index").screenshot({ path: "scratch/timeline-index.png" });
  return { ok: Object.values(details).every(d => d.ok), details };
}
