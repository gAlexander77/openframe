// Crossfades between audio clips as a person makes and sees them (ADR-109;
// the crossfade itself is ADR-104's set_crossfade), at 1280 x 720 and
// 1920 x 1080:
// - an audio clip's menu has Crossfade into next clip: on, it crossfades
//   with the transitions' default length (0.5 s) as far as the join
//   allows, checked and named "Crossfade" in undo; again, it removes it;
// - the timeline draws the crossfade where the mix plays one, over the
//   seconds before the cut, ending on it; clicking it opens the clip's
//   Audio tab, whose Crossfade row reads and sets the seconds;
// - one an agent sets over MCP is drawn too, under its notice;
// - where none fits (the next clip starts at the very start of its file)
//   choosing it says why; with nothing after the clip it is unavailable.
async (page) => {
  page.setDefaultTimeout(6000);
  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  for (const [w, h] of [
    [1280, 720],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.reload();
    await page.waitForFunction(() => !!window.videoEditor);
    await page.locator(".create-card").first().click();
    await page.locator(".timeline-panel").waitFor();
    const ids = await page.evaluate(async () => {
      const ve = window.videoEditor;
      const [song, song2] = await ve.import(["music-stereo.m4a", "music-30s.mp3"].map((n) => ({ name: n, src: `${location.origin}/fixtures/media/${n}` })));
      ve.exec("add_track", { kind: "audio", name: "Music", role: "music" });
      const mu = ve.project().tracks.find((t) => t.name === "Music").id;
      // A song, a second song from 3 s into its file, the second from its start.
      ve.exec("add_media_clip", { asset_id: song.id, start: 0, duration: 5, track_id: mu });
      ve.exec("add_media_clip", { asset_id: song2.id, start: 5, in: 3, duration: 5, track_id: mu });
      ve.exec("add_media_clip", { asset_id: song2.id, start: 10, in: 0, duration: 2, track_id: mu });
      const [a, b, c] = ve.project().tracks.find((t) => t.id === mu).clips.map((x) => x.id);
      return { a, b, c };
    });
    const insp = page.getByRole("region", { name: "Inspector" });
    const clip = (id) => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id), id);
    const undo = () => page.evaluate(() => window.videoEditor.state().undoLabel);
    const item = () => page.locator(".timeline-panel .menu .menu-item").filter({ has: page.locator(".menu-label").getByText("Crossfade into next clip", { exact: true }) });
    const menuOn = async (id) => {
      await page.locator(`[data-clip="${id}"]`).click({ button: "right", position: { x: 40, y: 10 } });
      await page.waitForTimeout(300);
    };
    const badges = () => page.locator(".tl-crossfade").evaluateAll((els) => els.map((e) => ({ tip: e.dataset.tip, label: e.getAttribute("aria-label"), l: e.getBoundingClientRect().left, r: e.getBoundingClientRect().right, t: e.getBoundingClientRect().top, b: e.getBoundingClientRect().bottom })));
    const box = async (id) => page.locator(`[data-clip="${id}"]`).boundingBox();

    await menuOn(ids.a);
    check(`${w}: the menu offers a crossfade`, (await item().count()) === 1 && !(await item().isDisabled()));
    await item().click();
    await page.waitForTimeout(250);
    check(`${w}: on with the default 0.5 s`, (await clip(ids.a)).crossfade === 0.5 && (await undo()) === "Crossfade", { crossfade: (await clip(ids.a)).crossfade, undo: await undo() });
    const [badge] = await badges();
    const a = await box(ids.a);
    const zoom = await page.evaluate(() => window.videoEditor.state().zoom);
    check(`${w}: drawn over the half second before the cut`, !!badge && Math.abs(badge.r - (a.x + a.width)) <= 1.5 && Math.abs(badge.r - badge.l - Math.max(16, 15 * zoom)) <= 1.5 && badge.t >= a.y && badge.b <= a.y + a.height && badge.tip === "Crossfade 0.50 s", { badge, clip: a, zoom });
    await page.screenshot({ path: `scratch/drive-shots/audio-crossfade-ui-${w}-badge.png` });

    await menuOn(ids.a);
    check(`${w}: the menu shows it on`, (await item().locator(".menu-check svg").count()) === 1);
    await page.keyboard.press("Escape");

    // The drawing opens the Audio tab on its Crossfade row.
    await page.evaluate(() => window.videoEditor.select([]));
    await page.locator(".tl-crossfade").first().click();
    await page.waitForTimeout(250);
    const row = insp.locator(".insp-row").filter({ has: page.locator(".insp-label", { hasText: /^Crossfade$/ }) });
    const field = row.locator("input.field");
    check(`${w}: clicking it opens the Audio tab's Crossfade row`, (await page.evaluate(() => window.videoEditor.state().selection)).join() === ids.a && (await insp.getByRole("tab", { selected: true }).textContent()) === "Audio" && (await field.inputValue()) === "0.50" && (await row.locator("input[type=range]").getAttribute("max")) === "2");
    await field.fill("1.25");
    await field.press("Enter");
    await page.waitForTimeout(250);
    const typed = await clip(ids.a);
    const [wide] = await badges();
    check(`${w}: the row sets the seconds, and the drawing follows`, typed.crossfade === 1.25 && !!wide && Math.abs(wide.r - wide.l - 37.5 * zoom) <= 1.5, { crossfade: typed.crossfade, wide });
    await field.fill("9");
    await field.press("Enter");
    await page.waitForTimeout(250);
    check(`${w}: past what the join allows, it stops at the most`, (await clip(ids.a)).crossfade === 2, { crossfade: (await clip(ids.a)).crossfade });
    const fits = await insp.evaluate((panel) => [...panel.querySelectorAll(".insp-row")].every((r) => r.getBoundingClientRect().right <= panel.getBoundingClientRect().right + 0.5));
    check(`${w}: the Audio tab fits`, fits);
    await insp.screenshot({ path: `scratch/drive-shots/audio-crossfade-ui-${w}-row.png` });

    // Removed from the menu; undo brings it back, drawn.
    await menuOn(ids.a);
    await item().click();
    await page.waitForTimeout(250);
    check(`${w}: the menu removes it`, (await clip(ids.a)).crossfade === undefined && (await badges()).length === 0 && (await undo()) === "Remove crossfade");
    await page.evaluate(() => window.videoEditor.action("undo"));
    await page.waitForTimeout(200);
    check(`${w}: undo brings it back`, (await clip(ids.a)).crossfade === 2 && (await badges()).length === 1);

    // A join with no file before the next clip: it says why.
    await menuOn(ids.b);
    await item().click();
    await page.waitForTimeout(250);
    const toasts = await page.locator(".toast").allTextContents();
    check(`${w}: where none fits it says what to change`, toasts.some((t) => /very start of its file: trim its start/.test(t)) && (await clip(ids.b)).crossfade === undefined, { toasts });
    // The last clip: nothing after it.
    await menuOn(ids.c);
    check(`${w}: nothing after it, no crossfade`, await item().isDisabled());
    await page.keyboard.press("Escape");

    // An agent's crossfade is drawn too.
    await page.evaluate(async (id) => {
      const ve = window.videoEditor;
      ve.exec("set_param", { clip_ids: [id], path: "in", value: 1 });
    }, ids.c);
    const res = await page.evaluate(async (id) => {
      const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "set_crossfade", arguments: { clip_id: id, seconds: 0.03 } } });
      return r.result?.isError ? r.result.content[0].text : "ok";
    }, ids.b);
    await page.waitForTimeout(250);
    const notice = await page.locator(".toasts-agent .toast").allTextContents();
    const drawn = await badges();
    check(`${w}: an agent's crossfade is drawn, under its notice`, res === "ok" && drawn.length === 2 && drawn.some((d) => d.tip === "Crossfade 0.030 s") && notice.some((t) => /Crossfade/.test(t)), { res, drawn, notice });
  }
  return { ok: Object.values(details).every((d) => d.ok), details };
};
