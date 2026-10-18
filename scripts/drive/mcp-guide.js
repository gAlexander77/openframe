// The MCP guide, live: through window.videoEditor.mcp, as a client sees it.
// initialize names the guide and offers prompts; tools carry titles and
// hints; help answers a playbook and a tool; list_catalog has an index and
// sections; a prompt comes back filled in; guide and catalog resources
// read; and the new commands work over MCP (set_fades in seconds,
// set_blend, duplicate_clips).
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const rpc = (method, params = {}) => page.evaluate(([method, params]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method, params }), [method, params]);
  const call = async (name, args = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    const text = r.result?.content?.[0]?.text ?? "";
    if (r.result?.isError) throw new Error(`${name}: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  const details = {};
  const init = await rpc("initialize");
  details.initialize = { ok: !!init.result.capabilities.prompts && /help/.test(init.result.instructions) && /list_catalog/.test(init.result.instructions) };
  const tools = (await rpc("tools/list")).result.tools;
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  details.hints = { ok: tools.every((t) => t.title && t.annotations) && byName.preview_frames.annotations.readOnlyHint && byName.delete_clips.annotations.destructiveHint, count: tools.length };
  const ad = await call("help", { topic: "ad" });
  const tool = await call("help", { topic: "set_canvas_fill" });
  details.help = { ok: /End card/.test(ad) && /fill/.test(tool) && /Example/.test(tool) };
  const index = await call("list_catalog");
  const effects = await call("list_catalog", { section: "effects" });
  details.catalog = { ok: index.sections.includes("sound_effects") && index.text_templates.includes("lowerThird") && effects.some((e) => e.id === "glow" && e.params.threshold), sections: index.sections.length };
  const prompt = await rpc("prompts/get", { name: "make_ad", arguments: { product: "A trail running shoe" } });
  details.prompt = { ok: /trail running shoe/.test(prompt.result.messages[0].content.text) };
  const guide = await rpc("resources/read", { uri: "guide://epic_edit" });
  const cat = await rpc("resources/read", { uri: "catalog://all" });
  details.resources = { ok: /analyze_music/.test(guide.result.contents[0].text) && JSON.parse(cat.result.contents[0].text).fonts.builtin.length > 5 };
  const proj = await call("describe_project");
  await call("add_color_clip", { color: "#204060", start: 0, duration: 4 });
  const origin = await page.evaluate(() => location.origin);
  const [m] = await call("import_media", { files: [{ src: origin + "/fixtures/media/music-30s.mp3", name: "music-30s.mp3" }] });
  const added = await call("add_media_clip", { asset_id: m.id, start: 0, duration: 4 });
  const music = added.added_clips.find((c) => c.type === "audio");
  const faded = await call("set_fades", { clip_ids: [music.id], fade_in: 0.5, fade_out: 1.5 });
  const color = (await call("describe_project")).tracks.flatMap((t) => t.clips).find((c) => c.type === "color");
  await call("set_blend", { clip_ids: [color.id], mode: "screen" });
  const dup = await call("duplicate_clips", { clip_ids: [color.id] });
  details.commands = { ok: faded.changed_clips[0].fade_in === 0.5 && faded.changed_clips[0].fade_out === 1.5 && dup.added_clips[0].start === 4 && dup.added_clips[0].blend === "screen", name: proj.name };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
