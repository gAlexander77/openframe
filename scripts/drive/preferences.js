// Preferences drive (Edit > Preferences, Mod+,): set pictures to 2 s,
// titles and effects to 1.5 s and transitions to 1 s; a picture from the
// library, a title preset and a dissolve then start at those lengths. The
// choice survives a reload, an out-of-range value clamps, and Reset to
// defaults restores 5 / 3 / 0.5 s.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const setField = async (name, v) => {
    const f = page.getByLabel(`${name} seconds`, { exact: true });
    await f.fill(String(v));
    await f.press("Enter");
  };
  await page.keyboard.press("Control+,");
  await page.locator(".prefs-dialog").waitFor();
  await setField("Pictures", 2);
  await setField("Titles and effects", 1.5);
  await setField("Transitions", 1);
  await page.getByRole("button", { name: "Done" }).click();

  const lens = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [ph] = await api.import([{ name: "photo.jpg", src: location.origin + "/fixtures/media/photo.jpg" }]);
    const { addToTimeline } = await import("/src/state/media.ts");
    const { addTextPreset, applyTransition } = await import("/src/state/apply.ts");
    api.seek(0);
    addToTimeline(api.project().assets.find((a) => a.id === ph.id));
    addToTimeline(api.project().assets.find((a) => a.id === ph.id));
    addTextPreset("default", 0);
    const main = api.project().tracks.find((t) => t.main).clips;
    applyTransition("dissolve", main[0].id);
    const all = api.project().tracks.flatMap((t) => t.clips);
    return { picture: main[0].duration, title: all.find((c) => c.type === "text")?.duration, transition: api.project().tracks.find((t) => t.main).clips[0].transitionOut?.duration };
  });
  details.lengths = { ok: lens.picture === 60 && lens.title === 45 && lens.transition === 30, ...lens };

  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: /Preferences/ }).click();
  details.persisted = { ok: (await page.getByLabel("Pictures seconds", { exact: true }).inputValue()) === "2" };
  await setField("Pictures", 999);
  details.clamped = { ok: (await page.getByLabel("Pictures seconds", { exact: true }).inputValue()) === "60" };
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  const back = await Promise.all(["Pictures", "Titles and effects", "Transitions"].map((n) => page.getByLabel(`${n} seconds`, { exact: true }).inputValue()));
  details.reset = { ok: JSON.stringify(back) === JSON.stringify(["5", "3", "0.5"]), back };
  await page.screenshot({ path: "scratch/preferences.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
