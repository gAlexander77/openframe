// Real mixer clicks, a shared detector across cuts, WAV ceiling, order/undo.
async (page) => {
  page.setDefaultTimeout(180000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  const trackId = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const { platform } = await import("/src/platform/index.ts");
    const { encodeWav } = await import("/src/lib/wav.ts");
    const pcm = Float32Array.from({ length: 12 * 48000 }, (_, n) => 0.8 * Math.sin(2 * Math.PI * 997 * n / 48000));
    const files = await platform.adoptFiles([new File([encodeWav([pcm], 48000)], "inserts-tone.wav", { type: "audio/wav" })]);
    const [asset] = await ve.import(files);
    ve.exec("add_track", { kind: "audio", name: "Dialog inserts" });
    const t = ve.project().tracks.find(t => t.name === "Dialog inserts");
    ve.exec("add_media_clip", { asset_id: asset.id, start: 0, duration: 12, track_id: t.id });
    return t.id;
  });
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  const strip = page.locator(`.mix-strip[data-track-id="${trackId}"]`);
  await strip.getByLabel("Insert type", { exact: true }).selectOption("compressor");
  await strip.getByRole("button", { name: "Add insert", exact: true }).click();
  await strip.getByRole("button", { name: "Compressor", exact: true }).click();
  const controls = page.getByRole("dialog", { name: "Compressor controls", exact: true });
  await controls.getByRole("slider", { name: "Compressor makeup", exact: true }).focus();
  await controls.getByRole("slider", { name: "Compressor makeup", exact: true }).press("End");
  await controls.getByRole("button", { name: "Close insert controls", exact: true }).click();
  await strip.getByLabel("Insert type", { exact: true }).selectOption("limiter");
  await strip.getByRole("button", { name: "Add insert", exact: true }).click();
  const initial = await page.evaluate(id => window.videoEditor.project().tracks.find(t => t.id === id).inserts, trackId);
  const details = { uiAdds: { ok: initial.map(i => i.type).join() === "compressor,limiter" } };
  const a = strip.locator(".audio-insert-item").nth(0), b = strip.locator(".audio-insert-item").nth(1);
  await b.dragTo(a);
  const reordered = await page.evaluate(id => window.videoEditor.project().tracks.find(t => t.id === id).inserts.map(i => i.id), trackId);
  await page.evaluate(() => window.videoEditor.action("undo"));
  const restored = await page.evaluate(id => window.videoEditor.project().tracks.find(t => t.id === id).inserts, trackId);
  details.reorderUndo = { ok: reordered[0] === initial[1].id && JSON.stringify(restored) === JSON.stringify(initial), reordered };
  Object.assign(details, await page.evaluate(async id => {
    const ve = window.videoEditor;
    const render = async () => {
      const file = await ve.render({ video: false, audioFormat: "wav", loudness: null });
      try { return await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await (await fetch(file.url)).arrayBuffer()); }
      finally { URL.revokeObjectURL(file.url); }
    };
    const call = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(JSON.stringify(r)); return JSON.parse(r.result.content.at(-1).text);
    };
    const whole = await render(), track = ve.project().tracks.find(t => t.id === id);
    await call("split", { clip_ids: [track.clips[0].id], at: 6 });
    const split = await render();
    let peak = 0, error = 0, energy = 0;
    for (let ch = 0; ch < split.numberOfChannels; ch++) {
      const x = split.getChannelData(ch), y = whole.getChannelData(ch);
      for (let i = 0; i < x.length; i++) {
        peak = Math.max(peak, Math.abs(x[i]));
        if (i > 4800 && i < x.length - 4800) { energy += y[i] ** 2; error += (x[i] - y[i]) ** 2; }
      }
    }
    const peakDb = 20 * Math.log10(peak), errorDb = 10 * Math.log10((error + 1e-20) / energy);
    const report = await call("measure_loudness");
    // Windowed output agrees with a continuous graph around 10 s too.
    const { renderMixWindow, mixPreroll } = await import("/src/engine/mixdown.ts");
    const p = ve.project(), continuous = await renderMixWindow(p, 0, 12 * 48000, 48000, 2, mixPreroll(p));
    let windowError = 0, windowEnergy = 0;
    for (let i = 10 * 48000; i < 11 * 48000; i++) { const x = split.getChannelData(0)[i], y = continuous.getChannelData(0)[i]; windowError += (x - y) ** 2; windowEnergy += y * y; }
    return {
      ceiling: { ok: peakDb <= -0.98 && peakDb > -1.2, peakDb },
      cutContinuity: { ok: errorDb < -60, errorDb },
      windowContinuity: { ok: windowError / windowEnergy < 1e-7, errorDb: 10 * Math.log10(windowError / windowEnergy) },
      measurement: { ok: Math.abs(report.sample_peak_dbfs - peakDb) < 0.15, report, peakDb },
    };
  }, trackId));
  return { ok: Object.values(details).every(d => d.ok), details };
}
