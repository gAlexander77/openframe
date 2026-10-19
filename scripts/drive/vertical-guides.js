// The TikTok, Reels and Shorts guide (Kapwing's safe zones; none of the
// editors we imitate has one): on a 9:16 canvas the viewer shades what the
// apps' buttons, captions and header cover and outlines the clear area,
// 14% from the top, 35% from the bottom, 11% left and 19% right. It is in
// the guides menu under the player and in View; like every guide it is
// DOM over the canvas, so it is never exported.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("set_project", { width: 1080, height: 1920 });
    v.exec("add_color_clip", { color: "#2a6f97", start: 0, duration: 2 });
    v.exec("add_text", { text: "Follow for part 2", start: 0, duration: 2 });
  });
  await page.getByLabel("Viewer guides").selectOption({ label: "TikTok, Reels, Shorts" });
  const box = page.locator(".viewer-safe-vertical");
  await box.waitFor();
  const canvas = await page.locator(".viewer-guides").boundingBox();
  const r = await box.boundingBox();
  const share = {
    top: (r.y - canvas.y) / canvas.height,
    bottom: (canvas.y + canvas.height - r.y - r.height) / canvas.height,
    left: (r.x - canvas.x) / canvas.width,
    right: (canvas.x + canvas.width - r.x - r.width) / canvas.width,
  };
  const near = (a, b) => Math.abs(a - b) < 0.01;
  const details = {};
  details.area = { ok: near(share.top, 0.14) && near(share.bottom, 0.35) && near(share.left, 0.11) && near(share.right, 0.19), share };
  await page.screenshot({ path: "__REPO__/scratch/vertical-guides.png" });
  details.state = { ok: (await page.evaluate(() => window.videoEditor.state().viewerGuides)) === "vertical" };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
