// Regression checks for the core editing audit. Browser-only shared UI evidence.
async (page) => {
  page.setDefaultTimeout(5000);
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  const details = {};
  const ids = await page.evaluate(() => {
    const a = window.videoEditor;
    const main = a.project().tracks.find(t => t.main);
    a.exec("add_color_clip", { color: "#223344", start: 0, duration: 6, track_id: main.id });
    const pic = a.project().tracks.find(t => t.main).clips[0].id;
    a.exec("add_color_clip", { color: "#445566", start: 6, duration: 8, track_id: main.id });
    a.exec("add_text", { text: "Small title", start: 0, duration: 6 });
    const title = a.project().tracks.flatMap(t => t.clips).find(c => c.type === "text").id;
    for (const [path, value] of [["transform.x", .38], ["transform.y", -.4], ["transform.scale", .3]]) a.exec("set_param", { clip_ids: [title], path, value });
    a.seek(30); a.select([]);
    return { pic, title };
  });
  const canvas = await page.locator(".player-canvas").boundingBox();
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  details.hitPicture = await page.evaluate(id => ({ ok: window.videoEditor.state().selection[0] === id, selection: window.videoEditor.state().selection }), ids.pic);
  details.noStrayZero = { ok: !(await page.locator(".player-frame").innerText()).includes("0") };
  const stage = await page.locator(".player-stage").boundingBox();
  await page.mouse.click(stage.x + 2, stage.y + 2);
  details.emptyDeselects = await page.evaluate(() => ({ ok: window.videoEditor.state().selection.length === 0 }));
  const apply = async (fn, arg) => page.evaluate(async ({ fn, arg }) => {
    const url = performance.getEntriesByType("resource").map(e => e.name).find(n => new URL(n).pathname === "/src/state/apply.ts");
    const mod = await import(url); mod[fn](arg);
  }, { fn, arg });
  await page.evaluate(id => window.videoEditor.select([id]), ids.pic);
  await apply("applyTransition", "dissolve");
  details.transitionAddOpens = { ok: await page.getByRole("tab", { name: "Transition", exact: true }).getAttribute("aria-selected") === "true" };
  await page.getByRole("tab", { name: "Video", exact: true }).click();
  await page.locator(".tl-transition").first().click();
  details.transitionMarkerOpens = { ok: await page.getByRole("tab", { name: "Transition", exact: true }).getAttribute("aria-selected") === "true" };
  await page.evaluate(() => window.videoEditor.seek(60));
  await apply("addTextPreset", "title");
  await page.waitForFunction(() => !window.videoEditor.state().playing);
  details.titleRestores = await page.evaluate(() => ({ ok: window.videoEditor.state().playhead === 60, frame: window.videoEditor.state().playhead }));
  await page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map(e => e.name).find(n => new URL(n).pathname === "/src/state/stickers.ts");
    const mod = await import(url);
    window.videoEditor.seek(90);
    await mod.addSticker(window.videoEditor.stickers()[0].id);
  });
  await page.waitForFunction(() => !window.videoEditor.state().playing);
  details.stickerRestores = await page.evaluate(() => ({ ok: window.videoEditor.state().playhead === 90, frame: window.videoEditor.state().playhead }));
  await page.evaluate(id => window.videoEditor.exec("set_param", { clip_ids: [id], path: "opacity", value: .8 }), ids.pic);
  details.humanUndo = await page.evaluate(() => ({ ok: window.videoEditor.state().undoLabel === "Change opacity", label: window.videoEditor.state().undoLabel }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => window.videoEditor.seek(120));
  await apply("addTextPreset", "title");
  details.reducedMotionStays = await page.evaluate(() => ({ ok: !window.videoEditor.state().playing && window.videoEditor.state().playhead === 120 }));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => window.videoEditor.seek(150));
  await apply("addTextPreset", "title");
  await page.evaluate(() => { window.videoEditor.action("shuttleStop"); window.videoEditor.seek(180); });
  await page.waitForTimeout(700);
  details.pauseCancelsReturn = await page.evaluate(() => ({ ok: !window.videoEditor.state().playing && window.videoEditor.state().playhead === 180 }));
  return { ok: Object.values(details).every(d => d.ok), details };
}
