// Groups drive: Premiere's Group (Ctrl+G). Two clips on different tracks
// grouped: a click selects both, a drag moves both, Alt+click picks one,
// a copy pastes as its own group, Ctrl+Shift+G ungroups.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(() => {
    const api = window.videoEditor;
    api.exec("add_color_clip", { color: "#203040", start: 0, duration: 8 });
    api.exec("add_text", { text: "Lower third", start: 1, duration: 2 });
    api.exec("add_color_clip", { color: "#a04040", start: 1, duration: 2 });
    const clips = api.describe().tracks.flatMap((t) => t.clips);
    return { text: clips.find((c) => c.type === "text").id, color: clips.filter((c) => c.type === "color").find((c) => c.start === 1).id };
  });
  const sel = () => page.evaluate(() => window.videoEditor.state().selection);
  const clip = (id) => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id), id);
  const box = (id) => page.locator(`[data-clip="${id}"]`).boundingBox();
  const details = {};

  await page.evaluate((ids) => window.videoEditor.select([ids.text, ids.color]), ids);
  await page.locator(".tl-ruler").click({ position: { x: 1200, y: 10 } });
  await page.evaluate((ids) => window.videoEditor.select([ids.text, ids.color]), ids);
  await page.keyboard.press("Control+G");
  const g = (await clip(ids.text)).group;
  details.grouped = { ok: !!g && g === (await clip(ids.color)).group };

  await page.evaluate(() => window.videoEditor.select([]));
  const t = await box(ids.text);
  await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
  details.clickSelectsGroup = { ok: (await sel()).length === 2 };

  const before = [(await clip(ids.text)).start, (await clip(ids.color)).start];
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2 + 60, t.y + t.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = [(await clip(ids.text)).start, (await clip(ids.color)).start];
  details.dragMovesGroup = { ok: after[0] > before[0] && after[0] - before[0] === after[1] - before[1], before, after };

  await page.evaluate(() => window.videoEditor.select([]));
  const t2 = await box(ids.text);
  await page.keyboard.down("Alt");
  await page.mouse.click(t2.x + t2.width / 2, t2.y + t2.height / 2);
  await page.keyboard.up("Alt");
  details.altPicksOne = { ok: JSON.stringify(await sel()) === JSON.stringify([ids.text]) };

  // Copy the group and paste: the copies form their own group.
  await page.evaluate(() => window.videoEditor.select([]));
  await page.mouse.click(t2.x + t2.width / 2, t2.y + t2.height / 2);
  await page.keyboard.press("Control+C");
  await page.evaluate(() => window.videoEditor.seek(200));
  await page.keyboard.press("Control+V");
  const pasted = await page.evaluate(() => {
    const api = window.videoEditor;
    const s = new Set(api.state().selection);
    return api.project().tracks.flatMap((t) => t.clips).filter((c) => s.has(c.id)).map((c) => c.group);
  });
  details.pasteRegroups = { ok: pasted.length === 2 && pasted[0] && pasted[0] === pasted[1] && pasted[0] !== g, pasted };

  await page.keyboard.press("Control+Shift+G");
  await page.evaluate(() => window.videoEditor.select([]));
  const t3 = await box(ids.text);
  await page.mouse.click(t3.x + t3.width / 2, t3.y + t3.height / 2);
  details.ungroupOriginalsKept = { ok: (await sel()).length === 2 };
  await page.evaluate((ids) => window.videoEditor.select([ids.text]), ids);
  await page.keyboard.press("Control+Shift+G");
  await page.evaluate(() => window.videoEditor.select([]));
  await page.mouse.click(t3.x + t3.width / 2, t3.y + t3.height / 2);
  details.ungrouped = { ok: (await sel()).length === 1 && !(await clip(ids.text)).group };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
