// The AI agent's notice (ADR-093) names each of the fifth round's commands
// as the inspector and timeline would (ADR-109): a border's width is
// "Change border width", not "Change width"; colorize's amount "Change
// colorize amount", not "Change amount"; set_colorize "Colorize", not
// "Change colorize"; turning a thing off says "Remove ..."; the undo step
// reads the same. Through window.videoEditor.mcp, as the desktop bridge
// and the docked assistant call it.
async (page) => {
  page.setDefaultTimeout(6000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").first().click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [song, song2] = await ve.import(["music-stereo.m4a", "music-30s.mp3"].map((n) => ({ name: n, src: `${location.origin}/fixtures/media/${n}` })));
    ve.exec("add_color_clip", { color: "#ffffff", start: 0, duration: 3 });
    ve.exec("add_media_clip", { asset_id: song.id, start: 0, duration: 5 });
    ve.exec("add_media_clip", { asset_id: song2.id, start: 5, in: 3, duration: 5 });
    const clips = ve.project().tracks.flatMap((t) => t.clips);
    const [a, b] = clips.filter((c) => c.type === "audio").map((c) => c.id);
    return { pic: clips.find((c) => c.type === "color").id, a, b };
  });
  const details = {};
  const calls = [
    ["set_border", { clip_ids: [ids.pic], color: "#ff0000", width: 12 }, "Change border"],
    ["set_param", { clip_ids: [ids.pic], path: "border.width", value: 20 }, "Change border width"],
    ["set_border", { clip_ids: [ids.pic], off: true }, "Remove border"],
    ["set_colorize", { clip_ids: [ids.pic], color: "#ffb347" }, "Colorize"],
    ["set_param", { clip_ids: [ids.pic], path: "adjust.colorize.amount", value: 0.5 }, "Change colorize amount"],
    ["set_colorize", { clip_ids: [ids.pic], off: true }, "Remove colorize"],
    ["set_shadow", { clip_ids: [ids.pic], blur: 20 }, "Change shadow"],
    ["set_shadow", { clip_ids: [ids.pic], off: true }, "Remove shadow"],
    ["set_crossfade", { clip_id: ids.a, seconds: 0.5 }, "Crossfade"],
    ["set_crossfade", { clip_id: ids.a, seconds: 0 }, "Remove crossfade"],
    ["set_compressor", { clip_ids: [ids.a], preset: "voice" }, "Change compressor"],
    ["set_compressor", { clip_ids: [ids.a], preset: "off" }, "Compressor off"],
    ["set_music_grid", { clip_id: ids.a, bpm: 120, first_downbeat: 0 }, "Change music grid"],
    ["set_clip_enabled", { clip_ids: [ids.pic, ids.b], enabled: false }, "Deactivate 2 clips"],
    ["set_clip_enabled", { clip_ids: [ids.pic], enabled: true }, "Activate clip"],
  ];
  for (const [name, args, want] of calls) {
    const r = await page.evaluate(async ([name, args]) => {
      const res = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      return res.error?.message ?? (res.result.isError ? res.result.content[0].text : "ok");
    }, [name, args]);
    await page.waitForTimeout(100);
    const notice = (await page.locator(".toasts-agent .toast").allTextContents()).join(" | ");
    const undo = await page.evaluate(() => window.videoEditor.state().undoLabel);
    details[`${name} ${JSON.stringify(args).replace(/"c_\w+"/g, "id")}`] = { ok: r === "ok" && notice === `AI agent${want}` && undo === want, r, notice, undo, want };
  }
  await page.screenshot({ path: "scratch/drive-shots/agent-notice-labels.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
