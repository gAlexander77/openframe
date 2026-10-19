// New titles fit their canvas (titleWrap). On a 9:16 project a long title
// added through MCP wraps inside the apps' column (maxWidth 0.62) and
// check_project finds nothing in its layout, measured with the engine's
// own text layout; the same title with the old default width (0.9) runs
// into the buttons. A Title added from the library's Text tab gets the
// same width. Back on 16:9 a centered title keeps the old 0.9 and one off
// center wraps inside the safe area. The 9:16 frame is saved to
// scratch/title-wrap.png.
async (page) => {
  const fs = await import("node:fs");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(10000);
  const details = {};
  const mcp = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const json = async (name, args = {}) => {
    const r = await mcp(name, args);
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    return JSON.parse(r.result.content[0].text);
  };
  const text = (id) => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id), id);
  const layout = async () => (await json("check_project", {})).findings.filter((f) => ["text_outside_title_safe", "text_under_app_buttons"].includes(f.rule));
  const LONG = "Every edit in OpenFrame is a tool an agent can call";

  await json("set_project", { width: 1080, height: 1920 });
  await json("add_color_clip", { color: "#14161c", start: 0, duration: 6 });
  const wrapped = (await json("add_text", { text: LONG, start: 0, duration: 3, y: -0.1, style: { size: 48, bold: true } })).added_clips[0].id;
  details.mcpWidth = { ok: (await text(wrapped)).style.maxWidth === 0.62, maxWidth: (await text(wrapped)).style.maxWidth };
  const findings = await layout();
  details.mcpFits = { ok: findings.length === 0, findings };
  const shot = await mcp("preview_frame", { at: 1.5, max_width: 540 });
  fs.mkdirSync("__REPO__/scratch", { recursive: true });
  fs.writeFileSync("__REPO__/scratch/title-wrap.png", Buffer.from(shot.result.content[0].data, "base64"));
  const old = (await json("add_text", { text: LONG, start: 3, duration: 3, y: -0.1, style: { size: 48, bold: true, maxWidth: 0.9 } })).added_clips[0].id;
  details.oldWidthKept = { ok: (await text(old)).style.maxWidth === 0.9 && (await layout()).some((f) => f.clip_id === old && f.rule === "text_under_app_buttons") };

  // The library's Text tab: a Title at the playhead.
  await page.click('.lib-tab:has-text("Text")');
  const before = await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).map((c) => c.id));
  await page.getByRole("button", { name: "Add Title", exact: true }).click();
  const added = await page.evaluate((before) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => !before.includes(c.id)), before);
  details.libraryWidth = { ok: added?.type === "text" && added.style.maxWidth === 0.62, maxWidth: added?.style.maxWidth };

  // 16:9: centered as before, off center inside the safe area.
  await json("new_project", { name: "Wide" });
  await json("add_color_clip", { color: "#14161c", start: 0, duration: 3 });
  const mid = (await json("add_text", { text: "Centered", start: 0, duration: 3 })).added_clips[0].id;
  const side = (await json("add_text", { text: LONG, start: 0, duration: 3, x: 0.25, style: { size: 96 } })).added_clips[0].id;
  const wide = await layout();
  details.wide = { ok: (await text(mid)).style.maxWidth === 0.9 && (await text(side)).style.maxWidth === 0.4 && wide.length === 0, findings: wide };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
