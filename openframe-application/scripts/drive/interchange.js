// Browser interchange path: capture save-picker bytes, pick those files back
// through the real importer, and compare integer-frame document structure.
async (page) => {
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  await page.evaluate(async () => {
    window.__timelineFiles = {};
    window.showSaveFilePicker = async ({ suggestedName }) => ({
      name: suggestedName,
      createWritable: async () => ({
        write: async (chunk) => { window.__timelineFiles[suggestedName] = new TextDecoder().decode(chunk.data); },
        close: async () => {}, abort: async () => {},
      }),
    });
    const { platform } = await import("/src/platform/index.ts");
    const adopt = platform.adoptUrl;
    // Keep HTTP references, which a timeline file on the web can resolve.
    platform.adoptUrl = async () => null;
    let media;
    try {
      media = await window.videoEditor.import([
        { src: `${location.origin}/fixtures/media/framecode-30.mp4`, name: "Shot.mp4" },
        { src: `${location.origin}/fixtures/media/voice-8s.wav`, name: "Music.wav" },
      ]);
    } finally { platform.adoptUrl = adopt; }
    if (media.some(m => !m.id)) throw new Error(JSON.stringify(media));
    const [video, audio] = media;
    const api = window.videoEditor;
    api.exec("set_project", { name: "__QA_interchange", fps: "30" });
    api.exec("add_media_clip", { asset_id: video.id, start: 0, in: 1, duration: 2 });
    api.exec("add_media_clip", { asset_id: video.id, start: 2, in: 4, duration: 2 });
    api.exec("add_media_clip", { asset_id: video.id, start: 5, in: 7, duration: 1 });
    const main = api.project().tracks.find(t => t.main);
    api.exec("set_transition", { clip_id: main.clips[0].id, type: "dissolve", duration: 0.4 });
    api.exec("add_track", { kind: "video", name: "Overlay" });
    const overlay = api.project().tracks.find(t => t.name === "Overlay");
    api.exec("add_media_clip", { asset_id: video.id, track_id: overlay.id, start: 1, in: 2, duration: 1 });
    api.exec("add_media_clip", { asset_id: video.id, track_id: overlay.id, start: 4, in: 3, duration: 1 });
    const nested = api.project().tracks.find(t => t.id === overlay.id).clips.find(c => c.start === 120);
    api.exec("create_compound_clip", { clip_ids: [nested.id], name: "Nested" });
    api.exec("add_media_clip", { asset_id: audio.id, start: 1, in: 1, duration: 4 });
    api.exec("add_marker", { at: 2, label: "Cut & cue" });
  });
  const source = await page.evaluate(() => window.videoEditor.project());
  const shape = (p) => ({
    tracks: p.tracks.map(t => [t.name, t.kind, !!t.main, t.clips.map(c => [c.type, c.start, c.duration, c.in ?? 0, c.transitionOut ?? null])]),
    markers: p.markers.map(m => [m.frame, m.label]),
    compounds: (p.compounds ?? []).map(k => [k.name, k.tracks.map(t => [t.name, t.clips.map(c => [c.type, c.start, c.duration, c.in ?? 0])])]),
  });
  const fileMenu = () => page.locator(".menubar-button", { hasText: /^File$/ }).click();
  // Keyboard reaches the new submenu at the minimum desktop size.
  await page.setViewportSize({ width: 1100, height: 680 });
  await fileMenu();
  const submenu = page.getByRole("menuitem", { name: "Export timeline", exact: true });
  await submenu.focus();
  await submenu.press("ArrowRight");
  const otioItem = page.getByRole("menuitem", { name: "OpenTimelineIO", exact: true });
  details.keyboardSubmenu = { ok: await otioItem.evaluate(el => el === document.activeElement) };
  await otioItem.click();
  await page.getByRole("dialog", { name: "Timeline exported", exact: true }).waitFor();
  details.reportFits = { ok: await page.getByRole("dialog").evaluate(el => { const r = el.getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight && el.scrollWidth <= el.clientWidth + 1; }) };
  await page.getByRole("button", { name: "Close", exact: true }).click();
  for (const format of ["fcpxml", "edl"]) {
    const r = await page.evaluate(format => window.videoEditor.exec("export_timeline", { format }), format);
    details[`export_${format}`] = { ok: r.files.length === (format === "edl" ? 2 : 1), result: r };
  }
  const files = await page.evaluate(() => window.__timelineFiles);
  const otio = Object.entries(files).find(([name]) => name.endsWith(".otio"));
  const fcpxml = Object.entries(files).find(([name]) => name.endsWith(".fcpxml"));
  details.bytes = { ok: !!otio && !!fcpxml && JSON.parse(otio[1]).OTIO_SCHEMA === "Timeline.1" && fcpxml[1].includes('version="1.10"') && Object.values(files).some(text => text.includes("FCM: NON-DROP FRAME")) };
  for (const [format, entry] of [["otio", otio], ["fcpxml", fcpxml]]) {
    const chooser = page.waitForEvent("filechooser");
    await fileMenu();
    await page.getByRole("menuitem", { name: "Import timeline", exact: false }).click();
    await (await chooser).setFiles({ name: entry[0], mimeType: format === "otio" ? "application/json" : "application/xml", buffer: Buffer.from(entry[1]) });
    await page.getByRole("dialog", { name: "Timeline imported", exact: true }).waitFor();
    const imported = await page.evaluate(() => window.videoEditor.project());
    details[`roundtrip_${format}`] = { ok: imported.id !== source.id && JSON.stringify(shape(imported)) === JSON.stringify(shape(source)), expected: shape(source), actual: shape(imported) };
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  // MCP uses the same import path and returns a summary plus all warnings.
  const chooser = page.waitForEvent("filechooser");
  const rpc = page.evaluate(() => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "import_timeline", arguments: {} } }));
  const offline = JSON.parse(otio[1]);
  const videoTrack = offline.tracks.children.find(t => t.kind === "Video" && !t.metadata?.openframe?.companion);
  const clip = videoTrack.children.find(c => c.OTIO_SCHEMA === "Clip.1");
  clip.media_reference = { OTIO_SCHEMA: "MissingReference.1" };
  clip.effects = [{ OTIO_SCHEMA: "TimeEffect.1", name: "Speed ramp" }];
  await (await chooser).setFiles({ name: "offline.otio", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(offline)) });
  const response = await rpc;
  const answer = JSON.parse(response.result.content[0].text);
  details.mcpImport = { ok: !response.result.isError && answer.opened && answer.project.counts && answer.warnings.some(w => /Speed ramp/.test(w)) && answer.warnings.some(w => /Missing media/.test(w)), answer };
  const saved = await page.evaluate(async id => { const { platform } = await import("/src/platform/index.ts"); return platform.loadProject(id); }, source.id);
  details.originalSaved = { ok: saved.id === source.id && JSON.stringify(shape(saved)) === JSON.stringify(shape(source)) };
  details.webPathRefused = { ok: await page.evaluate(async () => {
    try { await window.videoEditor.exec("import_timeline", { file: "C:/cut.otio" }); return false; } catch (e) { return /desktop only/.test(e.message); }
  }) };
  return { ok: Object.values(details).every(d => d.ok), details };
}
