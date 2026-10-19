// Pick a color from the screen (CapCut's chroma key picker, Premiere's
// eyedroppers): every color field has a pipette where the platform offers
// the EyeDropper API (Chromium, WebView2). Headless has no screen to
// sample, so the drive stands in a picker that answers a known color and
// checks it lands, in one undo step, and that a canceled pick changes
// nothing.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.evaluate(() => {
    window.__answer = "#12ab34";
    window.EyeDropper = class {
      async open() {
        if (!window.__answer) throw new DOMException("Canceled", "AbortError");
        return { sRGBHex: window.__answer };
      }
    };
  });
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("add_text", { text: "Picked", start: 0, duration: 2 });
    const t = v.project().tracks.flatMap((x) => x.clips).find((c) => c.type === "text");
    v.select([t.id]);
    return t.id;
  });
  const color = () => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).style.color, id);
  const details = {};
  const pipette = page.getByRole("button", { name: "Pick text color from the screen" });
  await pipette.click();
  details.picked = { ok: (await color()) === "#12ab34" && (await page.evaluate(() => window.videoEditor.state().undoLabel)) === "Text color", color: await color() };
  await page.evaluate(() => (window.__answer = null));
  await pipette.click();
  details.canceled = { ok: (await color()) === "#12ab34" };
  // The background field in the project details has one too.
  await page.evaluate(() => window.videoEditor.select([]));
  details.everywhere = { ok: (await page.getByRole("button", { name: /^Pick .* from the screen$/ }).count()) >= 1 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
