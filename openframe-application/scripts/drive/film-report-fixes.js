// Film 3/4 regressions through MCP and the real text rasterizer (ADR-135).
async (page) => {
  page.setDefaultTimeout(900000);
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const raw = (name, args = {}) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const call = async (name, args = {}) => {
    const r = await raw(name, args);
    if (r.error || r.result?.isError) throw new Error(name + ": " + JSON.stringify(r));
    return r.result.content;
  };
  const text = async (name, args) => JSON.parse((await call(name, args)).find((c) => c.type === "text").text);
  await call("set_project", { width: 1080, height: 1920 });
  await call("add_ad_element", { element: "end_card", start: 0, duration: 3, headline: "Make every trip\nfeel cinematic" });
  details.lines = await page.evaluate(async () => {
    const p = window.videoEditor.project();
    const c = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "text" && c.text === "Make every trip\nfeel cinematic");
    const { rasterizeText } = await import("/src/engine/text.ts");
    const r = rasterizeText(c, p.width, p.height);
    const wide = rasterizeText({ ...c, style: { ...c.style, maxWidth: 10 } }, p.width, p.height);
    return { ok: r.layout.lines.length === 2 && wide.width - 2 * wide.layout.pad <= c.style.maxWidth * p.width + 1, lines: r.layout.lines, size: c.style.size, maxWidth: c.style.maxWidth };
  });
  const ids = await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).map((c) => c.id));
  await call("delete_clips", { clip_ids: ids });
  await call("set_project", { width: 1920, height: 1080 });
  const [photo] = await text("import_media", { files: [{ src: "http://localhost:1420/fixtures/media/photo.jpg" }] });
  await call("add_markers", { times: Array.from({ length: 87 }, (_, i) => i / 2), label: "Beat" });
  const steps = [8,4,4,4,4,2,2,2,2,4,2,2,1,1,2,2,2,1,1,1,1,2,2,4,4,4,1,1,1,1,1,1,1,1,2,2,8];
  await call("cut_to_beats", { start: 0, end: 44, grid: "beats", mute: true, media: steps.map((beats) => ({ asset_id: photo.id, beats })) });
  details.montage = await page.evaluate(() => {
    const clips = window.videoEditor.project().tracks.find((t) => t.main).clips;
    const c = clips.at(-1);
    return { ok: clips.length === 37 && c.start === 1200 && c.start + c.duration === 1320, shots: clips.length, last: { start: c.start, duration: c.duration } };
  });
  await call("add_cinematic_bars", { ratio: 2 });
  const bars = await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "adjustment").id);
  const sheet = await call("export_versions", { versions: [{ ratio: "9:16", overrides: [{ clip_id: bars, hidden: true }] }], check: true, check_times: [1, 11.5, 29], reframe: "center", tile_width: 160 });
  details.versions = { ok: sheet.some((c) => c.type === "image" && c.data.length > 0), note: JSON.parse(sheet.find((c) => c.type === "text").text).note };
  const mixed = await raw("export_versions", { ratios: ["9:16"], check: true, check_times: [1], check_at: [0.5] });
  details.units = { ok: mixed.result?.isError && mixed.result.content[0].text.includes("mutually exclusive") };
  await call("add_sound_effect", { sounds: [{ name: "rise", end_at: 16, volume: 0.28 }, { name: "impact", start: 16, volume: 0.35 }, { name: "reverseCymbal", end_at: 32, volume: 0.22 }, { name: "braam", start: 32, volume: 0.22 }] });
  const check = await text("check_project", { kind: "epic_edit", detail: "full" });
  details.effects = { ok: !check.findings.some((f) => /join/.test(f.rule) && [16, 32].includes(f.at)), joins: check.findings.filter((f) => /join/.test(f.rule)) };
  const vo = await text("add_voiceover", { lines: [{ text: "Make every trip feel cinematic.", at: 0 }], captions: false });
  details.voice = await page.evaluate((vo) => {
    const p = window.videoEditor.project(), fps = p.fps.num / p.fps.den;
    const lines = vo.lines;
    return { ok: lines?.length > 0 && lines.every((l) => { const c = p.tracks.flatMap((t) => t.clips).find((c) => c.id === l.voice_clip); return c && Math.abs(l.start - c.start / fps) <= 0.00051 && Math.abs(l.end - (c.start + c.duration) / fps) <= 0.00051 && l.seconds > 0; }), lines };
  }, vo);
  return { ok: Object.values(details).every((d) => d.ok), details };
}
