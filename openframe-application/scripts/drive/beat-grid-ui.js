// A song's beat grid as a person sees and corrects it (ADR-119), at
// 1280 x 720, 1600 x 950 and 1920 x 1080, on a 128 BPM loop (kicks from
// 0.25 s):
// - a music clip's Audio tab has a Beat grid section; with no grid it
//   offers Detect beat grid, which reads the song and keeps one tempo and
//   a downbeat fitted to its beats (one undo step), drawn on the clip;
// - the tempo is typed, or tapped along (one undo step when the taps stop);
// - the downbeat is nudged 10 ms at a time, or set at the playhead, and the
//   clip's drawn bar lines and the song's Bar markers move with it, all
//   through set_music_grid, the agent's own command;
// - parts are added on the bar nearest the playhead, relabeled, removed;
// - an agent's grid shows in the section; Clear grid forgets it, undo
//   brings it back;
// - the section fits the inspector at every size.
// Screenshots go to scripts/drive/shots/.
async (page) => {
  page.setDefaultTimeout(8000);
  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  const dir = "scripts/drive/shots/";
  for (const [w, h] of [
    [1280, 720],
    [1600, 950],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.reload();
    await page.waitForFunction(() => !!window.videoEditor);
    await page.locator(".create-card").first().click();
    await page.locator(".timeline-panel").waitFor();
    const id = await page.evaluate(async () => {
      const ve = window.videoEditor;
      const [song] = await ve.import([{ name: "beat-128.m4a", src: `${location.origin}/fixtures/media/beat-128.m4a` }]);
      ve.exec("add_track", { kind: "audio", name: "Music", role: "music" });
      const mu = ve.project().tracks.find((t) => t.name === "Music").id;
      ve.exec("add_media_clip", { asset_id: song.id, start: 0, track_id: mu });
      const c = ve.project().tracks.find((t) => t.id === mu).clips[0].id;
      ve.select([c]);
      return c;
    });
    const insp = page.getByRole("region", { name: "Inspector" });
    const section = insp.locator(".insp-section").filter({ has: page.locator(".insp-section-toggle", { hasText: /^Beat grid$/ }) });
    const grid = () => page.evaluate((id) => {
      const p = window.videoEditor.project();
      const c = p.tracks.flatMap((t) => t.clips).find((x) => x.id === id);
      return p.assets.find((a) => a.id === c.assetId).musicGrid ?? null;
    }, id);
    const undo = () => page.evaluate(() => window.videoEditor.state().undoLabel);
    const ticks = () => page.locator(`[data-clip="${id}"] .clip-grid circle`).evaluateAll((cs) => cs.map((c) => ({ x: +c.getAttribute("cx"), bar: c.parentElement.classList.contains("bar"), left: c.getBoundingClientRect().left })));
    const fits = () => insp.evaluate((panel) => {
      const r = panel.getBoundingClientRect();
      return [...panel.querySelectorAll(".insp-section button, .insp-section input, .insp-section select")].filter((e) => e.offsetParent).every((e) => {
        const b = e.getBoundingClientRect();
        return b.left >= r.left - 0.5 && b.right <= r.right + 0.5;
      }) && panel.scrollWidth <= panel.clientWidth + 1;
    });

    // Detect.
    await page.waitForTimeout(300);
    check(`${w}: a song's Audio tab offers Detect beat grid`, (await section.count()) === 1 && (await section.getByRole("button", { name: "Detect beat grid" }).count()) === 1);
    await section.getByRole("button", { name: "Detect beat grid" }).click();
    await page.waitForFunction((id) => {
      const p = window.videoEditor.project();
      const c = p.tracks.flatMap((t) => t.clips).find((x) => x.id === id);
      return !!p.assets.find((a) => a.id === c.assetId).musicGrid;
    }, id, { timeout: 30000 });
    const read = await grid();
    const beat = 60 / 128;
    const phase = (((read.firstDownbeat - 0.25) % beat) + beat) % beat;
    check(`${w}: Detect keeps one tempo and a downbeat on the kicks`, Math.abs(read.bpm - 128) < 0.1 && Math.min(phase, beat - phase) < 0.015 && (await undo()) === "Detect beat grid", { read });
    const drawn = await ticks();
    check(`${w}: the clip draws the grid, bars marked`, drawn.length > 10 && drawn.some((t) => t.bar) && drawn.some((t) => !t.bar), { n: drawn.length });
    await page.screenshot({ path: `${dir}beat-grid-ui-${w}.png` });
    await insp.screenshot({ path: `${dir}beat-grid-ui-${w}-section.png` });
    check(`${w}: the section fits the inspector`, await fits());

    // An agent's grid shows in it, and Bar markers follow every change.
    await page.evaluate((id) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "set_music_grid", arguments: { clip_id: id, bpm: 128, first_downbeat: 0.25, markers: ["bars"] } } }), id);
    await page.waitForTimeout(250);
    const tempo = section.getByLabel("Tempo value"), first = section.getByLabel("First bar value");
    check(`${w}: an agent's grid shows`, (await tempo.inputValue()) === "128.00" && (await first.inputValue()) === "0.250");
    const barMarkers = () => page.evaluate(() => window.videoEditor.project().markers.filter((m) => m.label === "Bar").map((m) => m.frame));
    const bars0 = await barMarkers();
    const bar0 = (await ticks()).find((t) => t.bar);

    // Nudge later twice: the drawing and the markers move with it.
    await section.getByRole("button", { name: "Nudge downbeat later" }).click();
    await section.getByRole("button", { name: "Nudge downbeat later" }).click();
    await page.waitForTimeout(200);
    const nudged = await grid();
    const zoom = await page.evaluate(() => window.videoEditor.state().zoom);
    const bar1 = (await ticks()).find((t) => t.bar);
    const bars1 = await barMarkers();
    check(`${w}: a nudge moves the downbeat 10 ms, its drawing and its Bar markers`, Math.abs(nudged.firstDownbeat - 0.27) < 1e-6 && (await undo()) === "Nudge downbeat" && Math.abs(bar1.x - bar0.x - 0.02 * 30 * zoom) < 0.05 && bars1[2] - bars0[2] === 1, { nudged, bar0, bar1, zoom, bars0: bars0.slice(0, 3), bars1: bars1.slice(0, 3) });

    // Typed tempo; arrows step a tenth.
    await tempo.fill("120");
    await tempo.press("Enter");
    await page.waitForTimeout(150);
    check(`${w}: a typed tempo`, (await grid()).bpm === 120 && (await undo()) === "Set tempo");
    await tempo.press("ArrowUp");
    await page.waitForTimeout(150);
    check(`${w}: the arrow steps a tenth`, Math.abs((await grid()).bpm - 120.1) < 1e-6);

    // Tap along at 128: lands once, when the taps stop.
    const tap = section.getByRole("button", { name: "Tap tempo" });
    const before = await page.evaluate(() => window.videoEditor.state().undoDepth ?? null);
    const t0 = Date.now();
    for (let i = 0; i < 8; i++) {
      await tap.click();
      const next = t0 + (i + 1) * 468.75 - Date.now();
      if (next > 0) await page.waitForTimeout(next);
    }
    const live = await tap.textContent();
    await page.waitForTimeout(1700);
    const tapped = await grid();
    check(`${w}: tap tempo shows the tempo and lands it as one step`, /BPM/.test(live) && Math.abs(tapped.bpm - 128) < 3 && (await undo()) === "Tap tempo", { live, bpm: tapped.bpm, before });

    // Set the downbeat at the playhead (3.0 s): the grid's bar starts there.
    await page.evaluate(() => window.videoEditor.seek(90));
    await page.waitForTimeout(150);
    await section.getByRole("button", { name: "Set downbeat here" }).click();
    await page.waitForTimeout(150);
    check(`${w}: Set downbeat here puts a bar at the playhead`, Math.abs((await grid()).firstDownbeat - 3) < 1e-6 && (await undo()) === "Set downbeat");
    await page.evaluate((id) => window.videoEditor.exec("set_music_grid", { clip_id: id, bpm: 128, first_downbeat: 0.25 }), id);
    await page.waitForTimeout(150);

    // Parts: added on the nearest bar, relabeled, removed.
    await page.evaluate(() => window.videoEditor.seek(Math.round(7.9 * 30)));
    await page.waitForTimeout(150);
    await section.getByLabel("Part to add").selectOption("drop");
    await section.getByRole("button", { name: "Add here" }).click();
    await page.waitForTimeout(150);
    const parts = (await grid()).sections ?? [];
    check(`${w}: a part is added on the bar nearest the playhead`, parts.length === 1 && parts[0].label === "drop" && Math.abs(parts[0].at - (0.25 + 4 * 1.875)) < 1e-3 && (await undo()) === "Add drop", { parts });
    const row = section.locator(".grid-part").first();
    check(`${w}: the part shows where it plays`, (await row.locator(".grid-part-at").textContent()).trim().length > 0);
    await row.locator("select").selectOption("build");
    await page.waitForTimeout(150);
    check(`${w}: a part is relabeled`, (await grid()).sections?.[0]?.label === "build" && (await undo()) === "Change part");
    await insp.screenshot({ path: `${dir}beat-grid-ui-${w}-parts.png` });
    check(`${w}: the section fits with its parts`, await fits());
    await row.getByRole("button", { name: /^Remove the/ }).click();
    await page.waitForTimeout(150);
    check(`${w}: a part is removed`, !(await grid()).sections && (await undo()) === "Remove part");

    // Clear, then undo.
    await section.getByRole("button", { name: "Clear grid" }).click();
    await page.waitForTimeout(150);
    check(`${w}: Clear grid forgets it and offers Detect again`, (await grid()) === null && (await ticks()).length === 0 && (await section.getByRole("button", { name: "Detect beat grid" }).count()) === 1 && (await undo()) === "Clear beat grid");
    await page.evaluate(() => window.videoEditor.action("undo"));
    await page.waitForTimeout(150);
    check(`${w}: undo brings the grid back`, (await grid())?.bpm === 128 && (await ticks()).length > 0);

    // Not on a voice line.
    const voice = await page.evaluate(async () => {
      const ve = window.videoEditor;
      const [v] = await ve.import([{ name: "voice-8s.wav", src: `${location.origin}/fixtures/media/voice-8s.wav` }]);
      ve.exec("add_track", { kind: "audio", name: "Voiceover", role: "dialog" });
      const vo = ve.project().tracks.find((t) => t.name === "Voiceover").id;
      ve.exec("add_media_clip", { asset_id: v.id, start: 0, track_id: vo });
      const c = ve.project().tracks.find((t) => t.id === vo).clips[0].id;
      ve.select([c]);
      return c;
    });
    await page.waitForTimeout(200);
    check(`${w}: a voice line has no Beat grid`, !!voice && (await section.count()) === 0);
  }
  return { ok: Object.values(details).every((d) => d.ok), details };
};
