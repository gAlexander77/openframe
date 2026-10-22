// The actual mixer/checker and MP4 muxer, with deterministic steady sources:
// a one-frame fade, an infeasible ducking ceiling, and chapter readback.
async (page) => {
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = await page.evaluate(async () => {
    const ve = window.videoEditor, details = {};
    const call = async (name, args) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.result.isError) throw Error(r.result.content[0].text);
      return JSON.parse(r.result.content.find(c => c.type === "text").text);
    };
    const { platform } = await import("/src/platform/index.ts");
    const { encodeWav } = await import("/src/lib/wav.ts");
    const { toFcpxml } = await import("/src/lib/interchange/fcpxml.ts");
    const { timelineWarnings } = await import("/src/lib/interchange/warnings.ts");
    const urls = [];
    try {
      const media = [];
      for (const [name, gain, hz] of [["Voice.wav", 0.2, 220], ["Bed.wav", 0.001, 440]]) {
        const pcm = Float32Array.from({ length: 48000 * 6 }, (_, i) => gain * Math.sin(2 * Math.PI * hz * i / 48000));
        const files = await platform.adoptFiles([new File([encodeWav([pcm], 48000)], name, { type: "audio/wav" })]);
        const [a] = await ve.import(files); if (!a.id) throw Error(JSON.stringify(a)); media.push(a);
      }
      ve.exec("set_project", { width: 640, height: 360, fps: "30" });
      ve.exec("add_color_clip", { color: "#071322", start: 0, duration: 4 });
      const voiceTrack = (await call("add_track", { kind: "audio", name: "Dialog", role: "dialog" })).added_tracks[0].id;
      const musicTrack = (await call("add_track", { kind: "audio", name: "Music", role: "music" })).added_tracks[0].id;
      const voice = (await call("add_media_clip", { asset_id: media[0].id, start: 0, duration: 2.5, track_id: voiceTrack })).added_clips[0].id;
      await call("set_fades", { clip_ids: [voice], fade_out: 1 / 30 });
      const preview = await call("preview_audio", { start: 1, end: 3.5, solo: "voice", audio: false });
      const check = await call("check_project", { kind: "social_short" });
      details.cutoff = { ok: preview.edges.some(e => e.clips.includes(voice) && /cut off/.test(e.verdict)) && check.findings.some(f => f.rule === "sound_cut_off" && f.clip_id === voice), preview, findings: check.findings };
      details.stem = { ok: !JSON.stringify(preview.edges).match(/the music|new bar/), edges: preview.edges };
      await call("set_fades", { clip_ids: [voice], fade_out: 0.2 });
      const fixed = await call("preview_audio", { start: 1, end: 3.5, solo: "voice", audio: false });
      details.faded = { ok: !(fixed.edges ?? []).some(e => e.clips.includes(voice) && /cut off/.test(e.verdict)), preview: fixed };
      await call("add_media_clip", { asset_id: media[1].id, start: 0, duration: 4, track_id: musicTrack });
      const duck = await call("duck_under_speech", { track_id: musicTrack, voice_above_music_lu: 12, min_line_lu: 10, max_line_lu: 15, min_gap: 1.1, release: 0.55 });
      details.duck = { ok: duck.balance.per_line.max_lu > 15 && duck.balance.per_line.met === false && duck.balance.met === false, result: duck };
      await call("add_marker", { at: 0, label: "Preparation", chapter: true });
      await call("add_marker", { at: 2, label: "Discovery", chapter: true });
      await call("add_text", { text: "Why we explore", start: 0, duration: 4 });
      const p = ve.project(), xml = toFcpxml(p);
      details.interchange = { ok: xml.includes('<title ref="basic-title"') && xml.includes("<adjust-volume") && xml.includes("<fadeOut") && xml.includes("<chapter-marker"), warnings: timelineWarnings(p, "fcpxml") };
      const rendered = await ve.render({ format: "mp4", resolution: "480p", chapters: true }); urls.push(rendered.url);
      const [stored] = await platform.adoptFiles([new File([await (await fetch(rendered.url)).blob()], "film5-chapters.mp4", { type: "video/mp4" })]);
      const file = await call("preview_media", { file: stored.src, times: [0.5, 2.5], tile_width: 160 });
      const expected = [{ seconds: 0, title: "Preparation" }, { seconds: 2, title: "Discovery" }];
      details.chapters = { ok: JSON.stringify(rendered.chapters) === JSON.stringify(expected) && JSON.stringify(file.chapters) === JSON.stringify(expected), written: rendered.chapters, read: file };
    } finally { for (const url of urls) URL.revokeObjectURL(url); }
    return details;
  });
  return { ok: Object.values(details).every(x => x.ok), details };
}
