async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  // A self-contained PCM fixture served by this worktree's normal URL import.
  const samples = 48000 * 4, wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(8192 * Math.sin(2 * Math.PI * 440 * i / 48000)), 44 + i * 2);
  await page.route("**/fixtures/media/drive-tone.wav", (route) => route.fulfill({ contentType: "audio/wav", body: wav }));

  const details = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: Math.random(), method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(JSON.stringify(r));
      return JSON.parse(r.result.content[0].text);
    };
    const [asset] = await ve.import([{ name: "440 Hz tone.wav", src: `${location.origin}/fixtures/media/drive-tone.wav` }]);
    const id = (await call("add_media_clip", { asset_id: asset.id, start: 0, duration: 4 })).added_clips[0].id;
    ve.select([id]);
    const rms = (x, at) => {
      let energy = 0, n = Math.round(at * 48000);
      for (let i = n - 480; i < n + 480; i++) energy += x[i] ** 2;
      return Math.sqrt(energy / 960);
    };
    const curves = { linear: 0.5, equalPower: Math.SQRT1_2, logarithmic: Math.log10(5.5), exponential: (Math.sqrt(10) - 1) / 9, sCurve: 0.5 };
    const out = {};
    for (const [curve, expected] of Object.entries(curves)) {
      const before = JSON.stringify(ve.project());
      await call("set_fades", { clip_ids: [id], fade_in: 1, fade_out: 1, curve });
      const file = await ve.render({ video: false, audioFormat: "wav" });
      const bytes = await (await fetch(file.url)).arrayBuffer();
      const audio = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes);
      const ch = audio.getChannelData(0), dry = rms(ch, 2);
      const middleIn = rms(ch, 0.5) / dry, middleOut = rms(ch, 3.5) / dry;
      await call("undo");
      out[curve] = { ok: Math.abs(20 * Math.log10(middleIn / expected)) < 1 && Math.abs(20 * Math.log10(middleOut / expected)) < 1 && JSON.stringify(ve.project()) === before, middleIn, middleOut, expected };
    }
    await call("set_fades", { clip_ids: [id], fade_in: 1, curve_in: "sCurve" });
    return out;
  });
  const inspector = page.getByRole("region", { name: "Inspector" });
  await inspector.getByRole("tab", { name: "Audio" }).click();
  await inspector.getByRole("combobox", { name: "Fade in curve", exact: true }).selectOption("exponential");
  details.selector = { ok: await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "audio").fadeInCurve === "exponential") };
  details.ramp = { ok: await page.locator(".fade-shade path").first().getAttribute("d").then((d) => d.split("L").length > 20) };
  return { ok: Object.values(details).every((d) => d.ok), details };
}
