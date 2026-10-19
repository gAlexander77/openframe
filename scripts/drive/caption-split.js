// CapCut's Enter in a caption: editing "one two three four" on the canvas,
// with the caret after "one two ", Enter splits it into "one two" and
// "three four" where "three" is spoken (1.5 s), in one undo step, and the
// editor moves to the second half. Undo puts the caption back whole.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("add_color_clip", { color: "#334455", start: 0, duration: 4 });
    v.exec("add_captions", { captions: [{ start: 0, end: 3, text: "one two three four", words: [0, 0.5, 1.5, 2.2] }] });
    return v.project().tracks.flatMap((t) => t.clips).find((c) => c.caption).id;
  });
  await page.locator(`[data-clip="${id}"]`).dblclick({ position: { x: 20, y: 8 } });
  const area = page.locator(".te-text");
  await area.waitFor();
  await area.evaluate((el) => el.setSelectionRange(8, 8));
  await area.press("Enter");
  const caps = () =>
    page.evaluate(() =>
      window.videoEditor
        .project()
        .tracks.flatMap((t) => t.clips)
        .filter((c) => c.caption)
        .sort((a, b) => a.start - b.start)
        .map((c) => ({ id: c.id, text: c.text, start: c.start, duration: c.duration })),
    );
  const split = await caps();
  const details = {};
  details.split = { ok: split.length === 2 && split[0].text === "one two" && split[1].text === "three four" && split[1].start === 45 && split[0].duration === 45, split };
  details.undoLabel = { ok: (await page.evaluate(() => window.videoEditor.state().undoLabel)) === "Split caption" };
  details.editsSecond = { ok: (await page.evaluate(() => window.videoEditor.state().textEdit)) === split[1]?.id && (await area.inputValue()) === "three four" };
  await page.screenshot({ path: "__REPO__/scratch/caption-split.png" });
  await area.press("Escape");
  await page.keyboard.press("Control+z");
  const back = await caps();
  details.undo = { ok: back.length === 1 && back[0].text === "one two three four", back };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
