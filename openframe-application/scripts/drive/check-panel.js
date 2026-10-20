// The Check tab (ADR-111): check_project's findings as a person sees them,
// at 1280 x 720, 1600 x 950 and 1920 x 1080. An ad with footage, a title
// too small and low in contrast, a title past the safe area, a black gap,
// music cut off mid-sound and no end card:
// - the tab starts empty and checks on request, as the kind picked (Ad),
//   with its progress shown;
// - it finds what the agent's check_project finds, rule for rule, grouped
//   as text, timing and sound with counts, in words that name no tool;
// - a finding moves the playhead to its time, selects its clip and opens
//   the inspector tab that fixes it, and the timeline shows the playhead;
// - an edit marks the check stale; Check again clears what was fixed;
//   Cancel stops a run and keeps the last result;
// - the export dialog's Check row says what the last check found and
//   leads to the tab (Review), or runs the check when the project changed;
//   File > Check project opens the tab and runs it;
// - the tab never scrolls sideways.
// Screenshots go to scripts/drive/shots/.
async (page) => {
  page.setDefaultTimeout(20000);
  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  const dir = "scripts/drive/shots/";
  const sizes = [
    [1600, 950],
    [1280, 720],
    [1920, 1080],
  ];
  for (const [w, h] of sizes) {
    const at = `${w}x${h}`;
    await page.setViewportSize({ width: w, height: h });
    await page.reload();
    await page.waitForFunction(() => !!window.videoEditor);
    await page.locator(".create-card").first().click();
    await page.locator(".timeline-panel").waitFor();
    const ids = await page.evaluate(async () => {
      const v = window.videoEditor;
      const src = (n) => ({ name: n, src: `${location.origin}/fixtures/media/${n}` });
      const [video, music] = await v.import([src("h264-1080p30.mp4"), src("music-30s.mp3")]);
      const main = v.project().tracks.find((t) => t.main).id;
      // Footage 0-4 s, black 4-5 s, footage 5-8 s.
      v.exec("add_media_clip", { asset_id: video.id, start: 0, duration: 4, track_id: main });
      v.exec("add_media_clip", { asset_id: video.id, start: 5, in: 5, duration: 3, track_id: main });
      v.exec("add_text", { text: "SUMMER SALE", start: 1, duration: 3, style: { size: 30, color: "#d8d8d8" } });
      v.exec("add_text", { text: "Edge", start: 5, duration: 2, x: 0.46, style: { size: 90, stroke: { color: "#000000", width: 6 } } });
      // The song stops at 6 s, mid-phrase, with the picture going on.
      v.exec("add_media_clip", { asset_id: music.id, start: 0, duration: 6 });
      const clips = v.project().tracks.flatMap((t) => t.clips);
      v.select([]);
      v.seek(0);
      return { sale: clips.find((c) => c.text === "SUMMER SALE").id, edge: clips.find((c) => c.text === "Edge").id, music: clips.find((c) => c.type === "audio").id };
    });
    const state = () => page.evaluate(() => window.videoEditor.state());
    const insp = page.getByRole("region", { name: "Inspector" });
    const tab = page.locator(".check-tab");
    const done = async () => {
      await page.waitForFunction(() => !document.querySelector(".check-progress") && document.querySelector(".check-summary"), null, { timeout: 90000 });
      await page.waitForTimeout(150);
    };

    await page.getByRole("tab", { name: "Check" }).click();
    check(`${at}: the tab starts empty, with what it checks`, (await tab.locator(".empty").textContent()).includes("Check the edit before you export") && (await tab.locator(".check-summary").count()) === 0);
    await page.waitForTimeout(300); // the tab's fade-in
    if (w === 1600) await page.screenshot({ path: `${dir}check-empty-${at}.png` });
    await tab.getByRole("combobox", { name: "What you are making" }).selectOption("ad");
    check(`${at}: the kind says what it adds`, /end card/.test(await tab.locator(".lib-hint").textContent()));
    await tab.getByRole("button", { name: "Check project" }).click();
    const sawProgress = await tab.locator(".check-progress").waitFor({ timeout: 3000 }).then(() => true, () => false);
    if (sawProgress && w === 1600) await page.screenshot({ path: `${dir}check-running-${at}.png` });
    await done();
    check(`${at}: progress shows while it measures`, sawProgress);

    // The same findings as the agent's check_project.
    const agent = await page.evaluate(async () => JSON.parse((await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "check_project", arguments: { kind: "ad" } } })).result.content[0].text));
    const rows = await tab.locator(".check-row").evaluateAll((els) => els.map((e) => e.dataset.rule));
    const sorted = (xs) => [...xs].sort().join(",");
    const want = ["gap_on_main_track", "no_end_card", "sound_cut_off", "text_low_contrast", "text_outside_title_safe", "text_too_small"];
    check(`${at}: it finds what check_project finds`, sorted(rows) === sorted(agent.findings.map((f) => f.rule)) && want.every((r) => rows.includes(r)), { rows, agent: agent.findings.map((f) => f.rule) });
    const groups = await tab.locator(".check-group").evaluateAll((els) => els.map((g) => ({ label: g.querySelector(".check-group-head span").textContent, count: +g.querySelector(".check-count").textContent, rows: [...g.querySelectorAll(".check-row")].map((r) => r.dataset.rule) })));
    check(
      `${at}: grouped as text, timing and sound, with counts`,
      groups.map((g) => g.label).join() === "Text,Timing,Sound" && groups.every((g) => g.count === g.rows.length) && groups[0].rows.every((r) => /^text_/.test(r)) && groups[1].rows.includes("gap_on_main_track") && groups[1].rows.includes("no_end_card") && groups[2].rows.join() === "sound_cut_off",
      { groups },
    );
    const words = await tab.innerText();
    check(`${at}: plain words, no tool names`, !/set_text|set_param|style\.|trim_clip|align_clips|add_ad_element|set_fades|close_gaps|edit_compound|_clip/.test(words) && /“SUMMER SALE” is too small to read on a phone/.test(words) && /Raise Size in the Text tab to \d+ or more/.test(words), { words: words.slice(0, 1200) });
    const head = await tab.locator(".check-summary strong").textContent();
    check(`${at}: the summary says what the counts mean`, /^\d+ errors? to fix before you export/.test(head) && (await tab.locator(".check-summary").getAttribute("class")).includes("error"), { head });
    await page.screenshot({ path: `${dir}check-found-${at}.png` });

    // A finding jumps, selects and opens the tab with the fix.
    const go = async (rule) => {
      await tab.locator(`.check-row[data-rule="${rule}"] .check-jump`).first().click();
      await page.waitForTimeout(250);
      const s = await state();
      return { playhead: s.playhead, selection: s.selection, tab: await insp.getByRole("tab", { selected: true }).textContent().catch(() => null) };
    };
    const small = await go("text_too_small");
    check(`${at}: too small goes to the title's Text tab`, small.playhead === 30 && small.selection.join() === ids.sale && small.tab === "Text", small);
    const cut = await go("sound_cut_off");
    check(`${at}: the cut-off song goes to its end and its Audio tab`, cut.playhead === 180 && cut.selection.join() === ids.music && cut.tab === "Audio", cut);
    const gap = await go("gap_on_main_track");
    check(`${at}: the gap goes to the black, with no clip selected`, gap.playhead === 120 && gap.selection.length === 0, gap);
    check(`${at}: the visited finding is marked`, (await tab.locator(".check-row.on").getAttribute("data-rule")) === "gap_on_main_track");
    // The timeline scrolls a far finding into view: zoomed in, the end.
    await page.locator(".tl-scroll").evaluate((el) => (el.scrollLeft = 0));
    for (let i = 0; i < 6; i++) await page.evaluate(() => window.videoEditor.action("zoomIn"));
    await go("no_end_card");
    const seen = await page.evaluate(() => {
      const el = document.querySelector(".tl-scroll");
      const head = document.querySelector(".tl-corner").offsetWidth;
      const s = window.videoEditor.state();
      const x = head + s.playhead * s.zoom;
      return { x, left: el.scrollLeft, width: el.clientWidth, playhead: s.playhead };
    });
    check(`${at}: the timeline shows the playhead it moved`, seen.playhead === 165 && seen.x >= seen.left && seen.x <= seen.left + seen.width, seen);
    await page.evaluate(() => window.videoEditor.action("zoomFit"));
    check(`${at}: no sideways scroll`, await tab.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));

    // An edit marks it stale; Check again finds what is left.
    await page.evaluate((id) => window.videoEditor.exec("set_text", { clip_id: id, style: { size: 80 } }), ids.sale);
    await page.waitForTimeout(150);
    check(`${at}: an edit marks the check stale`, await tab.locator(".check-stale").isVisible());
    await tab.getByRole("button", { name: "Check again" }).click();
    await done();
    const after = await tab.locator(".check-row").evaluateAll((els) => els.map((e) => e.dataset.rule));
    check(`${at}: checked again, the fixed title is gone`, !after.includes("text_too_small") && (await tab.locator(".check-stale").count()) === 0, { after });

    // Cancel keeps the last result.
    await tab.getByRole("button", { name: "Check again" }).click();
    const cancel = tab.getByRole("button", { name: "Cancel the check" });
    const canCancel = await cancel.waitFor({ timeout: 2000 }).then(() => true, () => false);
    if (canCancel) await cancel.click().catch(() => {});
    await page.waitForFunction(() => !document.querySelector(".check-progress"), null, { timeout: 30000 });
    check(`${at}: cancel stops a run and keeps the last result`, (await tab.locator(".check-row").count()) === after.length && (await tab.locator(".check-error").count()) === 0, { canCancel });

    // The export dialog's Check row.
    await page.locator(".export-btn").click();
    await page.waitForTimeout(400); // the dialog's opening animation
    const row = page.locator(".export-check");
    const rowText = await row.locator(".export-static").textContent();
    check(`${at}: Export says what the last check found`, /\d+ (errors?|warnings?|tips?)/.test(rowText) && (await row.getByRole("button").textContent()) === "Review", { rowText });
    await page.screenshot({ path: `${dir}check-export-row-${at}.png` });
    const fits = await page.locator(".export-dialog").evaluate((d) => {
      const r = d.getBoundingClientRect(), row = d.querySelector(".export-check").getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && row.height > 0;
    });
    check(`${at}: the export dialog still fits the window`, fits);
    await row.getByRole("button", { name: "Review" }).click();
    await page.waitForTimeout(200);
    check(`${at}: Review closes Export and shows the tab`, (await page.locator(".export-dialog").count()) === 0 && (await page.getByRole("tab", { name: "Check" }).getAttribute("aria-selected")) === "true");
    await page.evaluate((id) => window.videoEditor.exec("set_text", { clip_id: id, style: { size: 82 } }), ids.sale);
    await page.locator(".export-btn").click();
    check(`${at}: after an edit Export offers to check again`, (await row.getByRole("button").textContent()) === "Check again" && /before your last changes/.test(await row.textContent()));
    await row.getByRole("button", { name: "Check again" }).click();
    await done();
    check(`${at}: and runs it`, (await page.locator(".export-dialog").count()) === 0 && (await tab.locator(".check-stale").count()) === 0);

    // File > Check project opens the tab and runs it.
    await page.getByRole("tab", { name: "Media" }).click();
    await page.evaluate(() => window.videoEditor.exec("add_marker", { at: 2, label: "Edited" }));
    await page.locator(".menubar-button", { hasText: /^File$/ }).click();
    await page.getByRole("menuitem", { name: "Check project…" }).click();
    await page.locator(".check-tab").waitFor();
    await done();
    check(`${at}: File > Check project opens the tab and checks`, (await tab.locator(".check-stale").count()) === 0 && (await tab.locator(".check-row").count()) > 0);
    await page.screenshot({ path: `${dir}check-after-${at}.png` });
  }
  return { ok: Object.values(details).every((x) => x.ok), details };
};
