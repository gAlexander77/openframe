// How a model looks and checks, over MCP: preview_media shows an imported
// video's own frames; preview_motion shows consecutive frames of a stretch
// with the cuts and beat markers in it; check_project finds an off-safe
// title, a too-fast strobe and a black gap, and passes once they are fixed.
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
    return r.result.content;
  };
  const text = async (name, args) => JSON.parse((await call(name, args))[0].text);
  const origin = await page.evaluate(() => location.origin);
  const details = {};

  const [v] = await text("import_media", { files: [{ src: origin + "/fixtures/media/framecode-30.mp4", name: "framecode-30.mp4" }] });
  const media = await call("preview_media", { asset_id: v.id, count: 8, columns: 4, tile_width: 240 });
  details.previewMedia = { ok: media[0].type === "image" && media[0].data.length > 1000, bytes: media[0].data.length };
  await page.evaluate((d) => (window.__mediaSheet = d), media[0].data);

  const main = (await text("describe_project")).tracks.find((t) => t.main).id;
  await text("add_media_clip", { asset_id: v.id, start: 0, duration: 2, in: 1, track_id: main });
  await text("add_media_clip", { asset_id: v.id, start: 2, duration: 2, in: 6, track_id: main });
  await text("add_markers", { times: [1, 2, 3], label: "Beat" });
  const motion = await call("preview_motion", { start: 1.5, end: 2.5, fps: 10 });
  const info = JSON.parse(motion[1].text);
  details.previewMotion = { ok: motion[0].type === "image" && info.frames.length === 11 && JSON.stringify(info.cuts) === "[2]" && info.markers.some((m) => m.at === 2), info };
  await page.evaluate((d) => (window.__motionSheet = d), motion[0].data);

  const clips = (await text("describe_project")).tracks.flatMap((t) => t.clips);
  await text("add_text", { text: "Too far right", start: 0, duration: 3, x: 0.47 });
  await text("add_effect", { clip_id: clips[0].id, type: "flash", params: { rate: 8 } });
  await text("move_clip", { clip_id: clips[1].id, start: 2.5 });
  const bad = await text("check_project", { kind: "epic_edit" });
  const rules = bad.findings.map((f) => f.rule);
  details.findsProblems = { ok: !bad.ok && rules.includes("text_outside_title_safe") && rules.includes("flashes_too_fast") && rules.includes("gap_on_main_track"), rules };

  const title = (await text("describe_project")).tracks.flatMap((t) => t.clips).find((c) => c.type === "text");
  await text("align_clips", { clip_ids: [title.id], align: "right", margin: 0.05 });
  await text("edit_effects", { clip_id: clips[0].id, action: "clear" });
  await text("close_gaps", { track_id: main });
  const good = await text("check_project", { kind: "epic_edit" });
  details.fixed = { ok: good.ok && !good.findings.some((f) => ["text_outside_title_safe", "flashes_too_fast", "gap_on_main_track"].includes(f.rule)), rules: good.findings.map((f) => f.rule) };

  // The sheets, saved for a look by eye.
  const { writeFileSync } = await import("node:fs");
  for (const [k, file] of [["__mediaSheet", "mcp-review-media.png"], ["__motionSheet", "mcp-review-motion.png"]])
    writeFileSync(`__REPO__/scratch/${file}`, Buffer.from(await page.evaluate((k) => window[k], k), "base64"));
  return { ok: Object.values(details).every((d) => d.ok), details };
};
