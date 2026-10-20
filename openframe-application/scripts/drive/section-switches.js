// Inspector sections with a switch in their header (ADR-109), as a person
// meets them, at 1024 x 700, 1280 x 720, 1600 x 950 and 1920 x 1080:
// - turning Border, Shadow or Colorize on opens its section on the
//   settings it just made (they stayed closed: only the switch moved), even
//   after the viewer closed the section by hand, and Enter on the switch
//   keeps the keyboard focus on it (Colorize's remount sent it to the page);
// - a title an agent gave a drop shadow, a border or a colorize shows them
//   in its Text tab, where they can be changed and removed (a title has no
//   Video or Adjust tab, so they were out of reach);
// - a compound clip's Audio tab has no Channels row (its fill is not
//   mixed) and its compressor says it acts on the whole mix;
// - nothing in those sections runs past the inspector's edge.
async (page) => {
  page.setDefaultTimeout(6000);
  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  const shots = "scratch/drive-shots";
  for (const [w, h] of [
    [1024, 700],
    [1280, 720],
    [1600, 950],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => localStorage.removeItem("ve.sections"));
    await page.reload();
    await page.waitForFunction(() => !!window.videoEditor);
    await page.locator(".create-card").first().click();
    await page.locator(".timeline-panel").waitFor();
    const ids = await page.evaluate(async () => {
      const ve = window.videoEditor;
      const [song] = await ve.import([{ name: "music-stereo.m4a", src: `${location.origin}/fixtures/media/music-stereo.m4a` }]);
      const added = (fn) => {
        const before = new Set(ve.project().tracks.flatMap((t) => t.clips.map((c) => c.id)));
        fn();
        return ve.project().tracks.flatMap((t) => t.clips).find((c) => !before.has(c.id)).id;
      };
      const shape = added(() => ve.exec("add_color_clip", { color: "#ffffff", start: 0, duration: 3 }));
      const title = added(() => ve.exec("add_text", { text: "Framed", start: 0, duration: 3 }));
      ve.exec("set_shadow", { clip_ids: [title], blur: 30 });
      ve.exec("set_border", { clip_ids: [title], color: "#ff0000", width: 6 });
      ve.exec("set_colorize", { clip_ids: [title], color: "#ffb347" });
      const pic = added(() => ve.exec("add_color_clip", { color: "#336699", start: 3, duration: 3 }));
      const bed = added(() => ve.exec("add_media_clip", { asset_id: song.id, start: 3, duration: 3 }));
      ve.exec("create_compound_clip", { clip_ids: [pic, bed] });
      const compound = ve.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "compound").id;
      return { shape, title, compound };
    });
    const insp = page.getByRole("region", { name: "Inspector" });
    const clip = (id) => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id), id);
    const section = (title) => insp.locator(".insp-section").filter({ has: page.locator(".insp-section-toggle", { hasText: new RegExp(`^${title}$`) }) });
    const isOpen = (title) => section(title).evaluate((e) => e.classList.contains("open")).catch(() => null);
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
    /** Rows of the open sections that end past the inspector's right edge. */
    const overflow = () =>
      insp.evaluate((panel) => {
        const right = panel.getBoundingClientRect().right + 0.5;
        return [...panel.querySelectorAll(".insp-section.open .insp-row, .insp-section.open .insp-hint")].filter((r) => r.getBoundingClientRect().right > right || r.scrollWidth > r.clientWidth + 1).map((r) => r.textContent.slice(0, 40));
      });

    // The shape: each switch, turned on by Enter, opens its section and keeps the focus.
    await page.evaluate((id) => window.videoEditor.select([id]), ids.shape);
    for (const [tab, title, sw, key] of [
      ["Video", "Border", "Border", "border"],
      ["Video", "Shadow", "Drop shadow", "shadow"],
      ["Adjust", "Colorize", "Colorize", "colorize"],
    ]) {
      await insp.getByRole("tab", { name: tab, exact: true }).click();
      const was = await isOpen(title);
      await insp.getByRole("switch", { name: sw, exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(250);
      const c = await clip(ids.shape);
      const set = key === "colorize" ? c.adjust.colorize : c[key];
      check(`${w}: ${title} on opens its section`, was === false && set && (await isOpen(title)) === true && (await section(title).locator(".color-input").count()) === 1, { was, set });
      check(`${w}: ${title}'s switch keeps the focus`, (await focused()) === sw, { focused: await focused() });
      await section(title).scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(200);
      await insp.screenshot({ path: `${shots}/section-switches-${w}-${key}.png` });
      check(`${w}: ${title} fits the inspector`, (await overflow()).length === 0, { overflow: await overflow() });
    }
    // Closed by hand (remembered), switched off and on again: it opens.
    await insp.getByRole("tab", { name: "Video", exact: true }).click();
    await section("Border").locator(".insp-section-toggle").click();
    const closed = await isOpen("Border");
    await insp.getByRole("switch", { name: "Border", exact: true }).click();
    await insp.getByRole("switch", { name: "Border", exact: true }).click();
    await page.waitForTimeout(200);
    check(`${w}: a section closed by hand opens when switched on`, closed === false && (await isOpen("Border")) === true && !!(await clip(ids.shape)).border);

    // The title: the agent's drop shadow, border and colorize, in its Text tab.
    await page.evaluate((id) => window.videoEditor.select([id]), ids.title);
    await insp.getByRole("tab", { name: "Text", exact: true }).click();
    const titles = await insp.locator(".insp-section-toggle").allTextContents();
    check(`${w}: a title shows its drop shadow, border and colorize`, ["Drop shadow", "Border", "Colorize"].every((t) => titles.includes(t)) && titles.filter((t) => t === "Shadow").length === 1, { titles });
    await section("Border").scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(200);
    await insp.screenshot({ path: `${shots}/section-switches-${w}-title.png` });
    check(`${w}: the title's sections fit`, (await overflow()).length === 0, { overflow: await overflow() });
    await insp.getByRole("switch", { name: "Border", exact: true }).click();
    await page.waitForTimeout(200);
    const off = await clip(ids.title);
    const after = await insp.locator(".insp-section-toggle").allTextContents();
    check(`${w}: the title's border can be removed there`, !off.border && !after.includes("Border") && !!off.shadow, { undo: await page.evaluate(() => window.videoEditor.state().undoLabel) });
    await page.evaluate(() => window.videoEditor.action("undo"));
    await page.waitForTimeout(200);
    check(`${w}: undo brings the border and its section back`, !!(await clip(ids.title)).border && (await insp.locator(".insp-section-toggle").allTextContents()).includes("Border"));

    // The compound clip: no dead Channels row; the compressor names the mix.
    await page.evaluate((id) => window.videoEditor.select([id]), ids.compound);
    await insp.getByRole("tab", { name: "Audio", exact: true }).click();
    const rows = await insp.locator(".insp-label").allTextContents();
    if (!(await isOpen("Compressor"))) await section("Compressor").locator(".insp-section-toggle").click();
    const hint = await section("Compressor").locator(".insp-hint").textContent();
    check(`${w}: a compound clip has no Channels row`, !rows.includes("Channels") && rows.includes("Pan"), { rows });
    check(`${w}: its compressor acts on the mix`, /mix of everything inside/.test(hint), { hint });
    check(`${w}: the compound's Audio tab fits`, (await overflow()).length === 0, { overflow: await overflow() });
  }
  return { ok: Object.values(details).every((d) => d.ok), details };
};
