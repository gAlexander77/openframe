async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  // A self-contained PCM fixture served by this worktree's normal URL import.
  const samples = 48000 * 12, wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(8192 * Math.sin(2 * Math.PI * 440 * i / 48000)), 44 + i * 2);
  await page.route("**/fixtures/media/drive-tone.wav", (route) => route.fulfill({ contentType: "audio/wav", body: wav }));

  return page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: Math.random(), method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(JSON.stringify(r));
      return JSON.parse(r.result.content[0].text);
    };
    const [asset] = await ve.import([{ name: "440 Hz tone.wav", src: `${location.origin}/fixtures/media/drive-tone.wav` }]);
    const id = (await call("add_media_clip", { asset_id: asset.id, start: 0, duration: 12 })).added_clips[0].id;
    const render = async () => {
      const file = await ve.render({ video: false, audioFormat: "wav" });
      return new OfflineAudioContext(2, 1, 48000).decodeAudioData(await (await fetch(file.url)).arrayBuffer());
    };
    const pitch = (x, at) => {
      const from = Math.round(at * 48000), length = 4000;
      const score = (lag) => {
        let xy = 0, xx = 0, yy = 0;
        for (let i = from; i < from + length; i++) { const a = x[i], b = x[i + lag]; xy += a * b; xx += a * a; yy += b * b; }
        return xy / Math.sqrt(xx * yy);
      };
      let best = 0, before = score(24), now = score(25);
      for (let lag = 25; lag < 600; lag++) {
        const after = score(lag + 1);
        if (now > 0.85 && now > before && now >= after) { best = lag; break; }
        before = now; now = after;
      }
      if (!best) return NaN;
      const a = score(best - 1), b = score(best), c = score(best + 1);
      return 48000 / (best + 0.5 * (a - c) / (a - 2 * b + c));
    };
    const details = {};
    for (const semitones of [12, -12]) {
      const before = JSON.stringify(ve.project());
      await call("set_pitch", { clip_ids: [id], semitones });
      const audio = await render(), ch = audio.getChannelData(0), expected = 440 * 2 ** (semitones / 12);
      const frequencies = [1, 8, 10.1].map((at) => pitch(ch, at));
      let own = 0, join = 0;
      for (let i = 48000; i < ch.length - 48000; i++) if (i % 96000 > 8 && i % 96000 < 95992) own = Math.max(own, Math.abs(ch[i] - ch[i - 1]));
      for (const at of [2, 4, 6, 8, 10]) { const i = at * 48000; join = Math.max(join, Math.abs(ch[i] - ch[i - 1])); }
      await call("undo");
      details[`pitch${semitones}`] = { ok: frequencies.every((f) => Math.abs(f - expected) < 3) && Math.abs(audio.duration - 12) < 1 / 30 && join < own * 1.1 && JSON.stringify(ve.project()) === before, frequencies, duration: audio.duration, own, join };
    }
    await call("set_speed", { clip_id: id, speed: 2 });
    await call("set_pitch", { clip_ids: [id], semitones: 5 });
    const fast = await render(), expected = 440 * 2 ** (5 / 12);
    const hz = pitch(fast.getChannelData(0), 1);
    details.speed = { ok: Math.abs(hz - expected) < 3 && Math.abs(fast.duration - 6) < 1 / 30, hz, duration: fast.duration };
    await call("split", { clip_ids: [id], at: 3 });
    const split = (await render()).getChannelData(0), whole = fast.getChannelData(0);
    let error = 0; for (let i = 0; i < whole.length; i++) error = Math.max(error, Math.abs(whole[i] - split[i]));
    details.split = { ok: error < 1 / 32768 * 2, error };
    await call("undo");
    await call("set_reverse", { clip_id: id, reverse: true });
    const reversed = await render(), reverseHz = pitch(reversed.getChannelData(0), 1);
    details.reverse = { ok: Math.abs(reverseHz - expected) < 3, hz: reverseHz };
    return { ok: Object.values(details).every((d) => d.ok), details };
  });
}
