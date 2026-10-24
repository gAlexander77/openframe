// Read tools and the real panel with a deterministic log; inference is desktop-only.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload(); await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click(); await page.locator(".timeline-panel").waitFor();
  const details = {};
  // The tab on a project with no video yet (it once read a speech choice that did not exist).
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.getByRole("tab", { name: "Shot log", exact: true }).click();
  await page.locator(".shotlog-tab").waitFor();
  details.emptyProject = { ok: !errors.length && await page.getByRole("combobox", { name: "Shot log video" }).isVisible(), errors };
  await page.getByRole("tab", { name: "Media", exact: true }).click();
  const rpc = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const call = async (name, args) => {
    const response = await rpc(name, args), text = response.result?.content?.[0]?.text ?? "";
    if (response.result?.isError) throw new Error(`${name}: ${text}`);
    try { return JSON.parse(text); } catch { return text; }
  };
  const assetId = await page.evaluate(async () => {
    const [asset] = await window.videoEditor.import([{ name: "framecode-30.mp4", src: location.origin + "/fixtures/media/framecode-30.mp4" }]);
    return asset.id;
  });
  const unsupported = await rpc("analyze_footage", { asset_id: assetId });
  details.desktopNote = { ok: unsupported.result?.isError === true && unsupported.result.content[0].text.includes("Shot logs need the desktop app: it runs a local vision model this browser build cannot.") };
  await page.evaluate(async id => {
    const { installShotLogForTest } = await import("/src/state/shotlog.ts");
    const asset = window.videoEditor.project().assets.find(a => a.id === id);
    // framecode-30.mp4 is 10 s: a cut at 5 s, a silence 6.6 to 7.2 s.
    const spans = [[0, 5, 0], [5, 8, 1], [8, asset.duration, 1]];
    const moments = spans.map(([start, end, shot], i) => ({ start, end, shot, frames: [(start + end) / 2], measured: { motion: 0.03, luma: 0.5, loudness_db: -18, pan: null, rgb: [80, 120, 160] }, described: { shot_size: "medium", camera: "static", people: 1, on_screen_text: [i === 1 ? "SCOREBOARD" : "FRAMECODE"], action: ["A person waves.", "A person points at the score.", "People cheering and raising their arms."][i], mood: i === 2 ? "euphoric" : "calm", description: ["A seated person waves beside a fixed camera.", "A score fills the display with large numbers.", "An audience applauds during a celebration."][i] } }));
    installShotLogForTest(id, { version: 1, duration: asset.duration, model: "drive fixture", measured_at: "2026-10-23T00:00:00Z", interval: 30, shots: [{ start: 0, end: 5 }, { start: 5, end: asset.duration }], moments, silences: [[6.6, 7.2]], complete: true });
  }, assetId);
  const text = await call("get_shot_log", { asset_id: assetId });
  details.screenplay = { ok: typeof text === "string" && text.includes("00:05.00          CUT") && text.includes('On screen: "SCOREBOARD"'), text };
  const matches = await call("find_shots", { query: "scoreboard" });
  details.search = { ok: matches[0]?.asset_id === assetId && matches[0]?.start === 5, matches };
  const edits = await call("suggest_edit_points", { asset_id: assetId, ranges: [{ start: 5.1, end: 6.8 }, { start: 8.2, end: 9.5 }] });
  details.editPoints = { ok: edits.ranges[0].in.best.time === 5 && edits.ranges[0].out.best.time === 6.6 && edits.ranges[0].join_to_next.some(a => a.kind === "jump_cut"), edits };
  const brief = await call("get_shot_log", { asset_id: assetId, from: 5.1, to: 7, detail: "brief" });
  details.cutOutsideWindow = { ok: !brief.includes("CUT"), brief };
  const clamped = await call("suggest_edit_points", { asset_id: assetId, ranges: [{ start: -2, end: 3 }, { start: 8.2, end: 100 }] });
  details.clampedRanges = { ok: clamped.ranges[0].start === 0 && clamped.ranges[1].end === 10, clamped };
  const synonyms = await call("find_shots", { asset_id: assetId, query: "celebrate" });
  details.synonymSearch = { ok: synonyms.some(m => m.start === 8 && m.matched_words.includes("cheer")), synonyms };
  const highlights = await call("find_highlights", { asset_id: assetId, count: 1, scenes: false, min_length: 1, max_length: 2 });
  details.pictureHighlights = { ok: highlights.signals.includes("shot_log") && highlights.highlights.some(h => h.reasons.some(r => r.includes("picture:") && r.includes("shot log"))), highlights };
  await page.getByRole("tab", { name: "Shot log", exact: true }).click();
  await page.locator(".shotlog-moment").first().waitFor();
  details.panelMoments = { ok: await page.locator(".shotlog-moment").count() === 3 };
  await page.getByRole("textbox", { name: "Search shot log" }).fill("scoreboard");
  details.panelSearch = { ok: await page.locator(".shotlog-moment").count() === 1 && (await page.locator(".shotlog-moment").textContent()).includes("SCOREBOARD") };
  await page.locator(".shotlog-moment").click();
  await page.waitForFunction(() => document.querySelector(".source-monitor canvas")?.dataset.frame === "150");
  const sourceIn = await page.getByLabel("Source In", { exact: true }).textContent();
  const sourceOut = await page.getByLabel("Source Out", { exact: true }).textContent();
  details.sourceMarks = { ok: sourceIn === "00:00:05:00" && sourceOut === "00:00:07:29", sourceIn, sourceOut };
  details.sourceTime = { ok: await page.getByRole("slider", { name: "Source position" }).inputValue() === "150" };
  await page.getByRole("button", { name: "Close Source: framecode-30.mp4", exact: true }).click();
  await page.getByRole("textbox", { name: "Search shot log" }).fill("");
  await page.evaluate(async id => {
    const { peekShotLog, installShotLogForTest } = await import("/src/state/shotlog.ts");
    const log = structuredClone(peekShotLog(id));
    log.moments[2].described = structuredClone(log.moments[1].described);
    installShotLogForTest(id, log);
  }, assetId);
  await page.locator(".shotlog-fold").waitFor();
  details.foldedRows = { ok: await page.locator(".shotlog-moment").count() === 1 && (await page.locator(".shotlog-fold").textContent()).includes("alike x2") };
  await page.locator(".shotlog-fold").click();
  details.expandedRows = { ok: await page.locator(".shotlog-moment").count() === 3 && await page.locator(".shotlog-fold").getAttribute("aria-expanded") === "true" };
  await page.locator(".shotlog-fold").click();
  details.collapseRows = { ok: await page.locator(".shotlog-moment").count() === 1 };
  await page.evaluate(async id => {
    const { peekShotLog, installShotLogForTest } = await import("/src/state/shotlog.ts");
    // Deliberately retain stale loudness/silences: has_audio must gate them.
    installShotLogForTest(id, { ...peekShotLog(id), has_audio: false });
  }, assetId);
  const silentBrief = await call("get_shot_log", { asset_id: assetId, detail: "brief" });
  const silentFull = await call("get_shot_log", { asset_id: assetId, detail: "full" });
  const silentEdits = await call("suggest_edit_points", { asset_id: assetId, ranges: [{ start: 5.1, end: 6.8 }, { start: 8.2, end: 9.5 }] });
  details.noAudio = { ok: silentBrief.includes("[no audio]") && silentFull.includes("Sound: no audio") && !silentFull.includes("silence") && !JSON.stringify(silentEdits).includes("silence") && !silentEdits.ranges[0].join_to_next.some(a => ["L_cut", "J_cut"].includes(a.kind)), silentBrief, silentEdits };
  details.noWebThumbnails = { ok: await page.locator(".shotlog-thumbnail").count() === 0 };
  await page.setViewportSize({ width: 1100, height: 680 });
  details.minimumWindow = { ok: await page.locator(".shotlog-tab").evaluate(el => el.scrollWidth <= el.clientWidth + 1) };
  return { ok: Object.values(details).every(d => d.ok), details };
}
