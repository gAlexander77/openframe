// Keyboard reach on the timeline (UX-33): Tab from the timeline toolbar's
// zoom slider lands on the selected clip within a few presses; Right and Left move along the track, Up moves
// to the overlay above, each selecting what it focuses; Delete then acts on
// it. A mouse click on a clip does not focus it, so arrows still step frames.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(() => {
    const api = window.videoEditor;
    const m = api.project().tracks.find((x) => x.main).id;
    api.exec("add_color_clip", { color: "#203040", start: 0, duration: 2, track_id: m });
    api.exec("add_color_clip", { color: "#204030", start: 2, duration: 2, track_id: m });
    api.exec("add_track", { kind: "video", name: "Over" });
    const t = api.project().tracks.find((x) => x.name === "Over").id;
    api.exec("add_color_clip", { color: "#a04040", start: 2.5, duration: 1, track_id: t });
    const ts = api.project().tracks;
    const main = ts.find((x) => x.main).clips;
    return { a: main[0].id, b: main[1].id, o: ts.find((x) => x.name === "Over").clips[0].id };
  });
  const focused = () => page.evaluate(() => document.activeElement?.dataset?.clip ?? null);
  const selected = () => page.evaluate(() => window.videoEditor.state().selection.join());
  // Focus follows a frame later (focusClip waits for the clip to render),
  // so each check waits for it rather than racing it.
  const settle = (id) => page.waitForFunction((id) => document.activeElement?.dataset?.clip === id, id, { timeout: 1000 }).catch(() => {});
  const details = {};

  // A click selects without focusing; Right then steps a frame.
  await page.locator(`[data-clip="${ids.a}"]`).click({ position: { x: 20, y: 10 } });
  const before = await page.evaluate(() => window.videoEditor.state().playhead);
  await page.keyboard.press("ArrowRight");
  details.clickNoFocus = { ok: (await focused()) === null && (await page.evaluate(() => window.videoEditor.state().playhead)) === before + 1 };

  // Tab from the toolbar's last control reaches the selected clip.
  await page.locator(".zoom-slider").focus();
  let n = 0;
  while ((await focused()) === null && n++ < 6) await page.keyboard.press("Tab");
  details.tabReaches = { ok: (await focused()) === ids.a, presses: n };
  details.ring = { ok: await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle === "solid") };

  await page.keyboard.press("ArrowRight");
  await settle(ids.b);
  details.right = { ok: (await focused()) === ids.b && (await selected()) === ids.b };
  await page.keyboard.press("ArrowUp");
  await settle(ids.o);
  details.up = { ok: (await focused()) === ids.o && (await selected()) === ids.o };
  await page.keyboard.press("ArrowDown");
  await settle(ids.b);
  details.down = { ok: (await focused()) === ids.b };
  await page.keyboard.press("ArrowLeft");
  await settle(ids.a);
  details.left = { ok: (await focused()) === ids.a };
  const label = await page.evaluate(() => document.activeElement.getAttribute("aria-label"));
  details.label = { ok: /selected/.test(label ?? ""), label };
  await page.keyboard.press("Delete");
  details.delete = { ok: await page.evaluate((a) => !window.videoEditor.project().tracks.some((t) => t.clips.some((c) => c.id === a)), ids.a) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
