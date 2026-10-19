// Stack order must change rendered pixels; cleanup and undo must preserve keys.
async (page) => {
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1100, height: 680 });
  await page.goto("http://localhost:1420");
  await page.locator(".create-card").click();
  const id = await page.evaluate(async () => {
    const v = window.videoEditor;
    v.exec("add_color_clip", { color: "#39b077", start: 0, duration: 3 });
    const c = v.project().tracks.flatMap(t => t.clips)[0];
    v.exec("add_effect", { clip_id: c.id, type: "posterize", params: { levels: 3 } });
    v.exec("add_effect", { clip_id: c.id, type: "duotone", params: { amount: 100, hue: 30 } });
    v.exec("add_keyframe", { clip_id: c.id, path: "transform.scale", at: 0, value: 1 });
    v.select([c.id]);
    v.seek(0);
    await v.rendered();
    return c.id;
  });
  const inspector = page.getByRole("region", { name: "Inspector", exact: true });
  await inspector.getByRole("tab", { name: "Effects (2)", exact: true }).click();
  const clip = () => page.evaluate(id => window.videoEditor.project().tracks.flatMap(t => t.clips).find(c => c.id === id), id);
  const pixel = () => page.evaluate(async () => {
    await window.videoEditor.rendered();
    const p = window.videoEditor.pixels(64), i = (Math.floor(p.height / 2) * p.width + Math.floor(p.width / 2)) * 4;
    return [...p.data.slice(i, i + 3)];
  });
  const details = {};
  const original = await clip(), before = await pixel();
  await inspector.getByRole("button", { name: "Move effect down", exact: true }).first().click();
  const after = await pixel();
  details.reorder = { ok: (await clip()).effects[0].id === original.effects[1].id && before.some((v, i) => Math.abs(v - after[i]) > 3), before, after };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undoReorder = { ok: JSON.stringify((await clip()).effects) === JSON.stringify(original.effects) };
  await page.evaluate(id => {
    const v = window.videoEditor, c = v.project().tracks.flatMap(t => t.clips).find(c => c.id === id);
    v.exec("add_keyframe", { clip_id: id, path: `effects.${c.effects[0].id}.levels`, at: 0, value: 9 });
  }, id);
  const keyed = await clip();
  await inspector.getByRole("button", { name: "Reset effect", exact: true }).first().click();
  const reset = await clip();
  details.reset = { ok: reset.effects[0].params.levels === 5 && !reset.keyframes[`effects.${keyed.effects[0].id}.levels`] && !!reset.keyframes["transform.scale"] };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undoReset = { ok: JSON.stringify((await clip()).keyframes) === JSON.stringify(keyed.keyframes) };
  await inspector.getByRole("button", { name: "Disable all", exact: true }).click();
  details.disableAll = { ok: (await clip()).effects.every(e => !e.enabled) };
  await inspector.getByRole("button", { name: "Enable all", exact: true }).click();
  details.enableAll = { ok: (await clip()).effects.every(e => e.enabled) };
  await inspector.getByRole("button", { name: "Remove all", exact: true }).click();
  const cleared = await clip();
  details.removeAll = { ok: cleared.effects.length === 0 && Object.keys(cleared.keyframes).join() === "transform.scale" };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undoClear = { ok: (await clip()).effects.length === 2 && JSON.stringify((await clip()).keyframes) === JSON.stringify(keyed.keyframes) };
  details.controlsFit = { ok: await inspector.locator(".fx-head").evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth)) };
  const tabs = await inspector.locator('[role="tab"]').evaluateAll(els => els.map(el => ({ text: el.textContent, width: el.clientWidth, content: el.scrollWidth })));
  details.tabsFit = { ok: tabs.every(t => t.width >= t.content), tabs };
  await inspector.screenshot({ path: "scratch/effect-stack.png", animations: "disabled" });
  return { ok: Object.values(details).every(d => d.ok), details };
}
