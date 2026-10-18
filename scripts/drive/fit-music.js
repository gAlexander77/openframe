// Fit the music: fit_music (through window.videoEditor.mcp) slides a song
// so its drop lands where the cut wants it and ends it with the picture,
// faded out to nothing at the picture's end. Heard in the export's mix:
// music-30s.mp3 plays 220, 330, 440 and 550 Hz for a second each, so its
// pitch tells which second of the file plays; the fade is in the levels.
async (page) => {
  page.setDefaultTimeout(15000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const call = (name, args = {}) =>
    page.evaluate(async ([name, args]) => {
      const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      const c = r.result?.content?.[0];
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? c.text}`);
      return c.type === "text" ? JSON.parse(c.text) : c;
    }, [name, args]);
  const origin = new URL(page.url()).origin;
  const [photo, song] = await call("import_media", { files: ["photo.jpg", "music-30s.mp3"].map((n) => ({ src: `${origin}/fixtures/media/${n}`, name: n })) });
  await call("add_media_clip", { asset_id: photo.id, start: 0, duration: 6 });
  const music = (await call("add_media_clip", { asset_id: song.id, start: 0 })).added_clips[0];
  // The "drop" is the file's tenth second (440 Hz); it should land at 2 s.
  await call("add_markers", { times: [10], label: "Drop" });
  const fit = await call("fit_music", { clip_id: music.id, drop_at: 2, fade_out: 1 });
  const c = fit.changed_clips.find((x) => x.id === music.id);
  const desc = await call("describe_project");
  const details = {};
  details.placed = { ok: c.start === 0 && Math.abs(c.in - 8) < 1e-3 && c.end === 6 && desc.markers.find((m) => m.label === "Drop").at === 2, clip: c };

  const heard = await page.evaluate(async () => {
    const r = await window.videoEditor.render({ video: false, audioFormat: "wav", start: 0, end: 6 });
    const buf = await (await fetch(r.url)).arrayBuffer();
    URL.revokeObjectURL(r.url);
    const v = new DataView(buf), rate = v.getUint32(24, true);
    const at = (i) => v.getInt16(44 + i * 4, true) / 32768;
    const rms = (a, b) => {
      let s = 0, n = 0;
      for (let i = Math.floor(a * rate); i < Math.floor(b * rate); i++, n++) s += at(i) ** 2;
      return Math.sqrt(s / n);
    };
    // Pitch by autocorrelation: the mix's faint hiss adds zero crossings.
    const hz = (a, b) => {
      const x = [];
      for (let i = Math.floor(a * rate); i < Math.floor(b * rate); i++) x.push(at(i));
      let best = 0, lag = 0;
      for (let L = 40; L < 400; L++) {
        let s = 0;
        for (let i = 0; i + L < x.length; i++) s += x[i] * x[i + L];
        if (s > best) [best, lag] = [s, L];
      }
      return rate / lag;
    };
    return { seconds: (buf.byteLength - 44) / 4 / rate, start: hz(0.1, 0.5), drop: hz(2.1, 2.5), full: rms(3, 4.5), fading: rms(5.5, 5.8), last: rms(5.95, 5.99) };
  });
  details.heard = {
    // At 0 s the file's 8th second (220 Hz) plays; at 2 s its 10th (440 Hz).
    ok: Math.abs(heard.seconds - 6) < 0.05 && Math.abs(heard.start - 220) < 8 && Math.abs(heard.drop - 440) < 8 && heard.fading < heard.full * 0.6 && heard.last < heard.full * 0.1,
    ...heard,
  };
  // Ending on a bar instead, with the picture cut to match.
  await call("undo");
  await call("add_markers", { times: [1, 3, 5, 7], label: "Bar" });
  const bar = await call("fit_music", { clip_id: music.id, end: "bar", trim_picture: true });
  const after = await call("describe_project");
  details.onBar = { ok: after.duration === 5 && after.tracks.find((t) => t.main).clips[0].end === 5 && bar.changed_clips.some((x) => x.id === music.id && x.end === 5), duration: after.duration };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
