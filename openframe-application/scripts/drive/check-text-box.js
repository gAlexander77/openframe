// check_project measures a title's letters, not its raster's margin: on
// 9:16 a centered title with an outline and a big shadow passes the apps'
// zones and title safe (it was flagged before, and passed with the outline
// off), a title in the bottom zone is flagged with its measured box, and
// captions land above the apps' zone by default.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const rpc = (method, params = {}) => page.evaluate(([method, params]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method, params }), [method, params]);
  const call = async (name, args = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    return JSON.parse(r.result.content[0].text);
  };
  const details = {};
  await call("set_project", { width: 1080, height: 1920 });
  await call("add_color_clip", { color: "#3a2a20", start: 0, duration: 4 });
  const look = { size: 50, bold: true, stroke: { color: "#000000", width: 8 }, shadow: { color: "#000000", blur: 20, x: 0, y: 4 } };
  // Keep the intended safe title inside the app-safe width. Its long first
  // word fits; the second wraps, regardless of the installed font metrics.
  const mid = (await call("add_text", { text: "SMALL-BATCH BEANS", start: 0, duration: 3, x: -0.07, y: -0.02, style: { ...look, maxWidth: 0.6 } })).added_clips[0].id;
  const low = (await call("add_text", { text: "SHOP NOW", start: 0, duration: 3, y: 0.3, style: look })).added_clips[0].id;
  await call("add_captions", { captions: [{ start: 0, end: 2, text: "wake up to fire" }] });
  const r = await call("check_project", { kind: "social_short" });
  const of = (id) => r.findings.filter((f) => f.clip_id === id).map((f) => f.rule);
  const lowFinding = r.findings.find((f) => f.clip_id === low && f.rule === "text_under_app_buttons");
  details.centered = { ok: !of(mid).some((x) => x === "text_under_app_buttons" || x === "text_outside_title_safe"), rules: of(mid) };
  details.bottom = { ok: !!lowFinding && /bottom 35%/.test(lowFinding.message) && /box runs x/.test(lowFinding.message), message: lowFinding?.message };
  const cap = (await call("describe_project")).tracks.flatMap((t) => t.clips).find((c) => c.type === "text" && c.text === "wake up to fire");
  details.caption = { ok: cap?.transform?.y === 0.05 && !r.findings.some((f) => f.clip_id === cap.id && f.rule === "text_under_app_buttons"), y: cap?.transform?.y, found: r.findings.filter((f) => f.clip_id === cap?.id).map((f) => f.message) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
