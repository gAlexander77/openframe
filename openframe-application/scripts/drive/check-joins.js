// Clicks at joins in the project check (ADR-119), at 1280 x 720, 1600 x
// 950 and 1920 x 1080: a song cut on its bars as a butt cut (cut_music
// crossfade 0) leaves its click guard's hole at the join, which
// preview_audio's edges call a tick:
// - check_project (the agent's) and the Check tab both find it, as
//   click_at_join, under Sound, in words that name no tool, with the clip
//   menu's crossfade as the fix;
// - the finding selects the clip before the join, opens its Audio tab and
//   puts the playhead on the join;
// - Crossfade into next clip from the clip menu, then Check again: gone,
//   and preview_audio calls the join clean;
// - the joins are measured only when the check runs.
// Screenshots go to scripts/drive/shots/.
async (page) => {
  page.setDefaultTimeout(20000);
  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  const dir = "scripts/drive/shots/";
  for (const [w, h] of [
    [1600, 950],
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
      const [song] = await ve.import([{ name: "music-30s.mp3", src: `${location.origin}/fixtures/media/music-30s.mp3` }]);
      const main = ve.project().tracks.find((t) => t.main).id;
      ve.exec("add_color_clip", { color: "#203040", start: 0, duration: 12, track_id: main });
      ve.exec("add_track", { kind: "audio", name: "Music", role: "music" });
      const mu = ve.project().tracks.find((t) => t.name === "Music").id;
      ve.exec("add_media_clip", { asset_id: song.id, start: 0, duration: 16, track_id: mu });
      const clip = ve.project().tracks.find((t) => t.id === mu).clips[0].id;
      ve.exec("set_music_grid", { clip_id: clip, bpm: 120, first_downbeat: 0 });
      ve.exec("cut_music", { clip_id: clip, from: 4, to: 8, crossfade: 0 });
      const [a, b] = ve.project().tracks.find((t) => t.id === mu).clips.map((c) => c.id);
      // The song fades out at the end, as it should: only the join is wrong.
      ve.exec("set_fades", { clip_ids: [b], fade_out: 1.5 });
      ve.select([]);
      return { a, b };
    });
    const tab = page.locator(".check-tab");
    const insp = page.getByRole("region", { name: "Inspector" });
    const done = async () => {
      await page.waitForFunction(() => !document.querySelector(".check-progress") && document.querySelector(".check-summary"), null, { timeout: 90000 });
      await page.waitForTimeout(150);
    };
    const agentCheck = () => page.evaluate(async () => JSON.parse((await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "check_project", arguments: { detail: "full" } } })).result.content[0].text));
    const edges = () => page.evaluate(async () => JSON.parse((await window.videoEditor.mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "preview_audio", arguments: { start: 2, end: 6, solo: "music", audio: false } } })).result.content.at(-1).text).edges ?? []);

    // preview_audio hears a tick; the agent's check finds it at the join.
    const heard = (await edges()).find((e) => e.kind === "join");
    const agent = await agentCheck();
    const found = agent.findings.find((f) => f.rule === "click_at_join");
    check(`${w}: preview_audio hears the butt cut, and check_project finds it`, !!heard && heard.verdict !== "clean" && heard.dip_db <= -10 && !!found && found.clip_id === ids.a && found.at === 4 && found.fix === `set_crossfade clip_id ${ids.a} seconds 0.03`, { heard, found });

    // The Check tab finds the same, in a person's words.
    await page.getByRole("tab", { name: "Check" }).click();
    await tab.getByRole("button", { name: /^Check (project|again)$/ }).click();
    await done();
    const rows = await tab.locator(".check-row").evaluateAll((els) => els.map((e) => e.dataset.rule));
    const sorted = (xs) => [...xs].sort().join(",");
    check(`${w}: the tab finds what check_project finds`, sorted(rows) === sorted(agent.findings.map((f) => f.rule)) && rows.includes("click_at_join"), { rows });
    const row = tab.locator('.check-row[data-rule="click_at_join"]');
    const text = await row.innerText();
    const group = await row.evaluate((el) => el.closest(".check-group").querySelector(".check-group-head span").textContent);
    check(`${w}: under Sound, named for the song, with the clip menu's crossfade`, group === "Sound" && /A tick where the two pieces of “music-30s\.mp3” meet/.test(text) && /For a few milliseconds at the cut the sound drops [\d.]+ dB\./.test(text) && /Add a crossfade from the clip menu: right-click “music-30s\.mp3” and choose Crossfade into next clip\./.test(text) && !/set_crossfade|dip_db|_/.test(text), { text });
    await page.screenshot({ path: `${dir}check-joins-${w}.png` });
    check(`${w}: no sideways scroll`, await tab.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));

    // The finding goes to the join.
    await row.locator(".check-jump").click();
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => window.videoEditor.state());
    check(`${w}: it selects the clip before the join, on its Audio tab, the playhead on the join`, s.selection.join() === ids.a && s.playhead === 120 && (await insp.getByRole("tab", { selected: true }).textContent()) === "Audio", { selection: s.selection, playhead: s.playhead });

    // The fix as it says: the clip menu's crossfade. Then check again.
    await page.locator(`[data-clip="${ids.a}"]`).click({ button: "right", position: { x: 30, y: 12 } });
    await page.waitForTimeout(300);
    await page.locator(".timeline-panel .menu .menu-item").filter({ has: page.locator(".menu-label").getByText("Crossfade into next clip", { exact: true }) }).click();
    await page.waitForTimeout(250);
    check(`${w}: the stale check says so`, await tab.locator(".check-stale").isVisible());
    await tab.getByRole("button", { name: "Check again" }).click();
    await done();
    const after = await tab.locator(".check-row").evaluateAll((els) => els.map((e) => e.dataset.rule));
    const clean = (await edges()).find((e) => e.kind === "join");
    check(`${w}: crossfaded, the click is gone and the join is clean`, !after.includes("click_at_join") && clean?.verdict === "clean", { after, clean });
    await page.screenshot({ path: `${dir}check-joins-${w}-fixed.png` });
  }
  return { ok: Object.values(details).every((d) => d.ok), details };
};
