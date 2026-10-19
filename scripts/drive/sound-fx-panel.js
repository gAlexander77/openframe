// The Audio tab's Effects section (ADR-060): Low-pass on shows its cutoff
// (500 Hz, typed in Hz on a log slider), the Cathedral preset sets the
// reverb, Echo and Tape stop switch on with their defaults, and the reset
// takes everything off; describe_project agrees with the panel each time.
async (page) => {
  page.setDefaultTimeout(5000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [a] = await api.import([{ name: "beat-128.m4a", src: location.origin + "/fixtures/media/beat-128.m4a" }]);
    api.exec("add_media_clip", { asset_id: a.id, start: 0, duration: 8 });
    const c = api.project().tracks.flatMap((t) => t.clips).find((x) => x.type === "audio");
    api.select([c.id]);
    return c.id;
  });
  const described = () => page.evaluate((cid) => window.videoEditor.describe().tracks.flatMap((t) => t.clips).find((c) => c.id === cid), id);
  await page.getByRole("region", { name: "Inspector" }).getByRole("tab", { name: "Audio" }).click();
  // Closed while the clip has none.
  const section = page.locator(".insp-section").filter({ has: page.locator(".insp-section-toggle", { hasText: /^Effects$/ }) });
  const toggle = section.locator(".insp-section-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const details = {};
  await section.getByRole("switch", { name: "Low-pass" }).click();
  const field = section.getByRole("textbox", { name: "Low-pass cutoff value" });
  details.lowpassOn = { ok: (await field.inputValue()) === "500" && (await described()).lowpass?.cutoff === 500 };
  await field.fill("1200");
  await field.press("Enter");
  details.cutoffTyped = { ok: (await described()).lowpass?.cutoff === 1200, slider: await section.getByRole("slider", { name: "Low-pass cutoff" }).inputValue() };
  await section.getByRole("radio", { name: "Cathedral" }).click();
  details.reverb = { ok: (await described()).reverb?.decay === 6 && (await section.getByRole("radio", { name: "Cathedral" }).getAttribute("aria-checked")) === "true" };
  await section.getByRole("switch", { name: "Echo" }).click();
  await section.getByRole("switch", { name: "Tape stop" }).click();
  const all = await described();
  details.echoAndStop = { ok: all.echo?.time === 0.35 && all.tape_stop?.duration === 1, echo: all.echo, tape_stop: all.tape_stop };
  await page.waitForTimeout(300);
  await page.getByRole("region", { name: "Inspector" }).screenshot({ path: "scratch/sound-fx-panel.png" });
  await section.getByRole("button", { name: "Reset Effects" }).click();
  const off = await described();
  details.reset = { ok: !off.lowpass && !off.reverb && !off.echo && !off.tape_stop };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
