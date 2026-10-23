// Read tools and the real panel with a deterministic log; inference is desktop-only.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload(); await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click(); await page.locator(".timeline-panel").waitFor();
  const details = {};
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
    const moments = spans.map(([start, end, shot], i) => ({ start, end, shot, frames: [(start + end) / 2], measured: { motion: 0.03, luma: 0.5, loudness_db: -18, pan: null, rgb: [80, 120, 160] }, described: { shot_size: "medium", camera: "static", people: 1, on_screen_text: [i === 1 ? "SCOREBOARD" : "FRAMECODE"], action: ["A person waves.", "A person points at the score.", "A person celebrates."][i], mood: "excited", description: "A fixed camera shows a person beside a display." } }));
    installShotLogForTest(id, { version: 1, duration: asset.duration, model: "drive fixture", measured_at: "2026-10-23T00:00:00Z", interval: 30, shots: [{ start: 0, end: 5 }, { start: 5, end: asset.duration }], moments, silences: [[6.6, 7.2]], complete: true });
  }, assetId);
  const text = await call("get_shot_log", { asset_id: assetId });
  details.screenplay = { ok: typeof text === "string" && text.includes("00:05.00          CUT") && text.includes('On screen: "SCOREBOARD"'), text };
  const matches = await call("find_shots", { query: "scoreboard" });
  details.search = { ok: matches[0]?.asset_id === assetId && matches[0]?.start === 5, matches };
  const edits = await call("suggest_edit_points", { asset_id: assetId, ranges: [{ start: 5.1, end: 6.8 }, { start: 8.2, end: 9.5 }] });
  details.editPoints = { ok: edits.ranges[0].in.best.time === 5 && edits.ranges[0].out.best.time === 6.6 && edits.ranges[0].join_to_next.some(a => a.kind === "jump_cut"), edits };
  await page.getByRole("tab", { name: "Shot log", exact: true }).click();
  await page.locator(".shotlog-moment").first().waitFor();
  details.panelMoments = { ok: await page.locator(".shotlog-moment").count() === 3 };
  await page.getByRole("textbox", { name: "Search shot log" }).fill("scoreboard");
  details.panelSearch = { ok: await page.locator(".shotlog-moment").count() === 1 && (await page.locator(".shotlog-moment").textContent()).includes("SCOREBOARD") };
  await page.locator(".shotlog-moment").click();
  await page.waitForFunction(() => document.querySelector(".source-monitor canvas")?.dataset.frame === "150");
  details.sourceTime = { ok: await page.getByRole("slider", { name: "Source position" }).inputValue() === "150" };
  await page.getByRole("button", { name: "Close Source: framecode-30.mp4", exact: true }).click();
  await page.getByRole("textbox", { name: "Search shot log" }).fill("");
  await page.setViewportSize({ width: 1100, height: 680 });
  details.minimumWindow = { ok: await page.locator(".shotlog-tab").evaluate(el => el.scrollWidth <= el.clientWidth + 1) };
  return { ok: Object.values(details).every(d => d.ok), details };
}
