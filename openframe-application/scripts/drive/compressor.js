// Compressor (CapCut's Enhance voice): the Audio tab's Compressor section
// turns it on from a preset, a moved slider makes it Custom, Off removes
// it; set_compressor and describe_project agree with what the panel shows.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.openFrame);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(async () => {
    const [a] = await window.openFrame.import([{ name: "voice-8s.wav", src: location.origin + "/fixtures/media/voice-8s.wav" }]);
    window.openFrame.exec("add_media_clip", { asset_id: a.id, start: 0 });
    const c = window.openFrame.project().tracks.flatMap((t) => t.clips).find((x) => x.type === "audio");
    window.openFrame.select([c.id]);
    return c.id;
  });
  const described = () => page.evaluate((cid) => window.openFrame.describe().tracks.flatMap((t) => t.clips).find((c) => c.id === cid).compressor ?? "none", id);
  await page.getByRole("region", { name: "Inspector" }).getByRole("tab", { name: "Audio" }).click();
  const section = page.locator(".insp-section").filter({ has: page.getByRole("button", { name: "Compressor", exact: true }) });
  // Closed while the clip has none.
  const toggle = section.locator(".insp-section-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await section.getByRole("radio", { name: "Enhance voice" }).click();
  const voice = await described();
  const threshold = section.getByRole("slider", { name: "Threshold" });
  const visible = await threshold.isVisible();
  await page.evaluate((cid) => window.openFrame.exec("set_compressor", { clip_ids: [cid], threshold: -30 }), id);
  const custom = await described();
  const customShown = (await section.getByRole("radio", { checked: true }).count()) === 0;
  await page.screenshot({ path: "scratch/compressor.png" });
  await section.getByRole("radio", { name: "Off" }).click();
  const off = await described();
  return { ok: voice === "voice" && visible && custom === "custom" && customShown && off === "none", details: { voice, visible, custom, customShown, off } };
};
