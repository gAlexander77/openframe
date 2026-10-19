// Caption looks (CapCut's caption templates): with captions on the
// timeline, the Captions tab offers six looks; Boxed gives every caption a
// box and drops their outline in one undo step, Word pop brings the
// spoken-word highlight, and an agent sets one by name. Titles keep their
// own style.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("add_color_clip", { color: "#334455", start: 0, duration: 6 });
    v.exec("add_captions", { captions: [{ start: 0, end: 2, text: "first line here", words: [0, 0.6, 1.2] }, { start: 2, end: 4, text: "and the second" }] });
    v.exec("add_text", { text: "Title", start: 4, duration: 2 });
    v.seek(15);
  });
  const caps = () => page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).filter((c) => c.type === "text" && c.caption).map((c) => ({ box: !!c.style.background, stroke: !!c.style.stroke, highlight: c.style.highlight ?? null, y: c.transform.y })));
  const lib = page.getByRole("region", { name: "Library" });
  await lib.getByRole("tab", { name: "Captions", exact: true }).click();
  const details = {};
  details.offered = { ok: (await page.locator(".cap-look").count()) === 6 };
  await page.getByRole("button", { name: "Boxed captions" }).click();
  const boxed = await caps();
  details.boxed = { ok: boxed.length === 2 && boxed.every((c) => c.box && !c.stroke && Math.abs(c.y - 0.36) < 1e-9) && (await page.evaluate(() => window.videoEditor.state().undoLabel)) === "Caption look Boxed", boxed };
  await page.getByRole("button", { name: "Word pop captions" }).click();
  const pop = await caps();
  details.pop = { ok: pop.every((c) => !c.box && c.stroke && c.highlight === "#2ee59d"), pop };
  await page.screenshot({ path: "__REPO__/scratch/caption-looks.png" });
  const title = await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "text" && !c.caption).style.highlight ?? null);
  details.titleKept = { ok: title === null };
  await page.evaluate(() => window.videoEditor.exec("set_caption_look", { look: "neon" }));
  details.agent = { ok: (await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).filter((c) => c.caption).every((c) => c.style.shadow?.color === "#00e5ff"))) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
