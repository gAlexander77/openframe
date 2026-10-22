// Choose a preferred card, apply three cuts with the actual chord and
// undo them together; Preferences, closest-cut fallback and audio key.
async (page) => {
  page.setDefaultTimeout(12000);
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").first().click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const check = (name, ok, extra = {}) => details[name] = { ok: !!ok, ...extra };
  const ids = await page.evaluate(() => {
    const ve = window.videoEditor;
    // Color layers default to overlays; the no-selection key targets main.
    const main = ve.project().tracks.find(t => t.main).id;
    for (let i = 0; i < 4; i++) ve.exec("add_color_clip", { color: "#224466", track_id: main, start: i * 2, duration: 2 });
    return ve.project().tracks.find(t => t.main).clips.map(c => c.id);
  });
  // project() exposes frame-based clips in timeline order; describe() uses
  // seconds and calls transitionOut "transition".
  const clips = () => page.evaluate(() => window.videoEditor.project().tracks.find(t => t.main).clips);
  const fixture = await clips();
  check("four touching main clips", fixture.length === 4 && fixture.every((c, i) => c.start === i * 60 && c.duration === 60), { clips: fixture.map(c => ({ id: c.id, start: c.start, duration: c.duration })) });
  if (!details["four touching main clips"].ok) return { ok: false, details };
  await page.getByRole("tab", { name: "Transitions", exact: true }).click();
  const card = page.locator(".card").filter({ has: page.locator(".card-label", { hasText: /^Wipe left$/i }) });
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Set as default/ }).click();
  check("default badge", await card.locator(".transition-default").textContent() === "Default");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  check("preferred type", await page.getByLabel("Default video transition").inputValue() === "wipeLeft");
  await page.getByLabel("Transitions seconds").fill("0.8");
  await page.getByLabel("Audio crossfades seconds").fill("0.2");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.evaluate(ids => window.videoEditor.select(ids.slice(0, 3)), ids);
  await page.locator(".player-stage").focus();
  await page.keyboard.press("Control+Alt+d");
  const applied = await clips();
  check("three cuts with key", applied.length === 4 && applied.slice(0, 3).every(c => c.transitionOut?.type === "wipeLeft" && c.transitionOut.duration === 24) && !applied[3].transitionOut, { transitions: applied.map(c => c.transitionOut) });
  await page.keyboard.press("Control+z");
  const undone = await clips();
  check("one undo removes all", undone.length === 4 && undone.every(c => !c.transitionOut));
  await page.evaluate(() => { window.videoEditor.select([]); window.videoEditor.seek(118); });
  await page.keyboard.press("Control+Alt+d");
  const nearest = await clips();
  check("nearest main cut", nearest.length === 4 && nearest.filter(c => c.transitionOut).map(c => c.id).join() === ids[1], { transitions: nearest.map(c => ({ id: c.id, transition: c.transitionOut })) });
  const report = await page.evaluate(async ids => {
    const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "apply_default_transitions", arguments: { clip_ids: [ids[1], ids[3]] } } });
    return JSON.parse(r.result.content[0].text);
  }, ids);
  check("MCP skipped reasons", report.cuts?.skipped.some(c => c.reason === "already had one") && report.cuts?.skipped.some(c => c.reason === "no neighbor"), { cuts: report.cuts });
  const audio = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: "music", src: `${location.origin}/fixtures/media/music-stereo.m4a` }]);
    ve.exec("add_track", { kind: "audio", name: "Music cuts" });
    const t = ve.project().tracks.find(t => t.name === "Music cuts").id;
    ve.exec("add_media_clip", { asset_id: a.id, track_id: t, start: 0, duration: 2 });
    ve.exec("add_media_clip", { asset_id: a.id, track_id: t, start: 2, in: 4, duration: 2 });
    const id = ve.project().tracks.find(x => x.id === t).clips[0].id;
    ve.select([id]); return { id, track: t };
  });
  await page.keyboard.press("Control+Alt+Shift+d");
  check("audio default key", await page.evaluate(a => window.videoEditor.project().tracks.find(t => t.id === a.track).clips[0].crossfade === 0.2, audio));
  await page.keyboard.press("Control+z");
  await card.getByRole("button", { name: "Add Wipe left", exact: true }).click();
  check("audio card uses audio preference", await page.evaluate(a => window.videoEditor.project().tracks.find(t => t.id === a.track).clips[0].crossfade === 0.2, audio));
  await page.locator(".player-stage").focus();
  await page.keyboard.press("Shift+h");
  check("mute track key", await page.evaluate(a => window.videoEditor.project().tracks.find(t => t.id === a.track).muted, audio));
  await page.keyboard.press("Shift+h");
  await page.keyboard.press("Alt+s");
  check("solo track key", await page.evaluate(a => window.videoEditor.project().tracks.find(t => t.id === a.track).solo, audio));
  return { ok: Object.values(details).every(d => d.ok), details };
}
