// Space on a focused control (ADR-111, ADR-109's gap): a button, switch,
// tab or menu item reached with the keyboard is pressed by Space, as
// everywhere on the web; it played the timeline instead. Space still plays
// from the page, a focused timeline clip, a slider (UX-06), and a control a
// mouse click left focused (CapCut: Space always plays outside text).
async (page) => {
  page.setDefaultTimeout(8000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").first().click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  const id = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("add_color_clip", { color: "#336699", start: 0, duration: 10, track_id: v.project().tracks.find((t) => t.main).id });
    const c = v.project().tracks.flatMap((t) => t.clips)[0].id;
    v.select([c]);
    v.seek(0);
    return c;
  });
  const insp = page.getByRole("region", { name: "Inspector" });
  const playing = () => page.evaluate(() => window.videoEditor.state().playing);
  const stop = async () => {
    if (await playing()) await page.evaluate(() => window.videoEditor.action("playPause"));
    await page.waitForTimeout(100);
  };
  /** Focus `target` the way a keyboard user does: from the control before
   * it, with Tab. */
  const tabTo = async (target) => {
    await target.evaluate((el) => {
      const all = [...document.querySelectorAll("button, input, select, textarea, [tabindex]")].filter((x) => x.tabIndex >= 0 && !x.disabled && x.getClientRects().length);
      all[all.indexOf(el) - 1].focus();
    });
    await page.keyboard.press("Tab");
    return target.evaluate((el) => document.activeElement === el);
  };
  const space = async () => {
    await page.keyboard.press("Space");
    await page.waitForTimeout(250);
  };

  // A switch in the inspector, reached with Tab: Space toggles it.
  const sw = insp.getByRole("switch").first();
  await sw.waitFor();
  const name = await sw.getAttribute("aria-label");
  const before = await sw.getAttribute("aria-checked");
  const reached = await tabTo(sw);
  await space();
  const toggled = await insp.getByRole("switch", { name }).getAttribute("aria-checked");
  check("Space toggles a switch the keyboard reached", reached && toggled !== before && !(await playing()), { name, before, toggled, reached });
  await page.screenshot({ path: "scripts/drive/shots/space-switch-1600x950.png" });
  const still = await page.evaluate(() => document.activeElement?.getAttribute("role"));
  await space();
  check("and again turns it back, the focus kept", still === "switch" && (await insp.getByRole("switch", { name }).getAttribute("aria-checked")) === before && !(await playing()), { still });

  // The same switch (still focused from the keyboard) clicked with the
  // mouse: the focus is now a click's, so Space plays and the switch stays.
  await insp.getByRole("switch", { name }).click();
  await page.waitForTimeout(150);
  const clicked = await insp.getByRole("switch", { name }).getAttribute("aria-checked");
  await space();
  check("after a click Space plays and leaves the switch", (await playing()) && (await insp.getByRole("switch", { name }).getAttribute("aria-checked")) === clicked, { clicked });
  await stop();
  await page.evaluate((id) => window.videoEditor.action("undo"), id);

  // A library tab reached with Tab: Space opens it.
  const textTab = page.getByRole("tab", { name: "Text", exact: true });
  const reachedTab = await tabTo(textTab);
  await space();
  check("Space opens a library tab the keyboard reached", reachedTab && (await textTab.getAttribute("aria-selected")) === "true" && !(await playing()));

  // A menu item reached from the keyboard: Space chooses it.
  const zoom = await page.evaluate(() => window.videoEditor.state().zoom);
  await page.locator(".menubar-button", { hasText: /^View$/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: /^Zoom in/ }).waitFor();
  const first = await page.evaluate(() => document.activeElement?.textContent);
  await space();
  check("Space chooses a menu item", /Zoom in/.test(first ?? "") && (await page.evaluate(() => window.videoEditor.state().zoom)) > zoom && !(await playing()), { first });

  // Where Space plays: the page, a focused timeline clip, a slider.
  await page.evaluate(() => document.activeElement?.blur());
  await space();
  check("Space plays from the page", await playing());
  await stop();
  await page.evaluate((id) => window.videoEditor.select([id]), id);
  await page.locator(`[data-clip="${id}"]`).focus();
  await space();
  check("Space plays from a focused timeline clip", await playing());
  await stop();
  await page.getByRole("tab", { name: "Video", exact: true }).click().catch(() => {});
  const slider = insp.locator("input[type=range]").first();
  await slider.click();
  await space();
  check("Space plays after touching a slider (UX-06)", await playing());
  await stop();
  return { ok: Object.values(details).every((x) => x.ok), details };
};
