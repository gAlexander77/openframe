// Verify engine-drawn cards at rest and viewer double-click behavior (UX-28/34).
async (page) => {
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  const details = {};
  await page.mouse.move(1590, 940);
  for (const tab of ["Effects", "Transitions"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const cards = page.locator(".library-panel .card");
    for (let i = 0; i < await cards.count(); i++) {
      await cards.nth(i).scrollIntoViewIfNeeded();
      await cards.nth(i).locator(".eng-preview.ready").waitFor();
    }
    await cards.first().scrollIntoViewIfNeeded();
    await page.locator(".library-panel").screenshot({ path: `scratch/audit-${tab.toLowerCase()}.png` });
    const images = await cards.evaluateAll((els) => els.map((el) => ({ label: el.textContent, image: el.querySelector(".eng-preview").style.backgroundImage })));
    const unique = new Set(images.map((i) => i.image)).size;
    details[tab] = { ok: images.length > 1 && unique > 1, cards: images.length, distinctStills: unique, labels: images.map((i) => i.label) };
  }
  await page.evaluate(async () => {
    const v = window.videoEditor;
    v.exec("add_color_clip", { color: "#203040", start: 0, duration: 5 });
    v.exec("add_text", { text: "Double-click to edit", start: 0, duration: 5, style: { size: 100 } });
    v.select(v.project().tracks.flatMap((t) => t.clips).filter((c) => c.type === "text").map((c) => c.id));
    v.seek(30);
    await v.rendered();
  });
  const box = await page.locator(".tf-box").boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator(".te-text").waitFor();
  details.textEdit = { ok: await page.evaluate(() => document.activeElement === document.querySelector(".te-text") && !document.fullscreenElement) };
  await page.keyboard.press("Escape");
  const stage = await page.locator(".player-stage").boundingBox();
  await page.mouse.dblclick(stage.x + 4, stage.y + 4);
  await page.waitForFunction(() => !!document.fullscreenElement);
  details.emptyViewer = { ok: await page.evaluate(() => !!document.fullscreenElement && !document.querySelector(".te-text")) };
  await page.evaluate(() => document.exitFullscreen());
  return { ok: Object.values(details).every((d) => d.ok), details };
};
