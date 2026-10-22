async (page) => {
  page.setDefaultTimeout(15000);
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  const id = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [asset] = await ve.import([{ name: "speech-test.wav", src: `${location.origin}/fixtures/media/speech-test.wav` }]);
    ve.exec("add_media_clip", { asset_id: asset.id, start: 0 });
    const clip = ve.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "audio"); ve.select([clip.id]); return clip.id;
  });
  const details = await page.evaluate(async (id) => {
    const ve = window.videoEditor;
    const call = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: Math.random(), method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(JSON.stringify(r)); return JSON.parse(r.result.content[0].text);
    };
    const { LoudnessMeter } = await import("/src/lib/analysis/loudness.ts");
    const { scheduleAudio } = await import("/src/engine/audio.ts");
    const liveCtx = new AudioContext({ sampleRate: 48000 });
    await liveCtx.resume();
    const moduleUrl = URL.createObjectURL(new Blob([`
      registerProcessor("capture-voice", class extends AudioWorkletProcessor {
        constructor(options) {
          super(); this.start = options.processorOptions.start; this.length = options.processorOptions.length;
          this.data = [new Float32Array(this.length), new Float32Array(this.length)];
        }
        process(inputs) {
          const channels = inputs[0];
          for (let j = 0; j < 128; j++) {
            const i = currentFrame + j - this.start;
            if (i >= 0 && i < this.length) for (let c = 0; c < 2; c++) this.data[c][i] = channels[c]?.[j] ?? channels[0]?.[j] ?? 0;
          }
          if (currentFrame + 128 >= this.start + this.length) { this.port.postMessage(this.data, this.data.map((x) => x.buffer)); return false; }
          return true;
        }
      });
    `], { type: "text/javascript" }));
    await liveCtx.audioWorklet.addModule(moduleUrl); URL.revokeObjectURL(moduleUrl);
    const livePlanes = async (length) => {
      const at = Math.ceil((liveCtx.currentTime + 0.5) * 48000) / 48000;
      const tap = new AudioWorkletNode(liveCtx, "capture-voice", { channelCount: 2, channelCountMode: "explicit", processorOptions: { start: Math.round(at * 48000), length } });
      tap.connect(liveCtx.destination);
      const recorded = new Promise((resolve) => { tap.port.onmessage = (e) => resolve(e.data); });
      const run = scheduleAudio(liveCtx, tap, ve.project(), 0, length / 48000, at);
      const planes = await recorded;
      run.stop(); await run.done; tap.disconnect();
      return planes;
    };
    const details = {};
    const presets = await call("list_catalog", { section: "voice_presets" });
    for (const { id: preset } of presets) {
      const before = JSON.stringify(ve.project());
      await call("apply_voice_preset", { clip_ids: [id], preset });
      const m = await call("measure_loudness", {});
      const file = await ve.render({ video: false, audioFormat: "wav" });
      const audio = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await (await fetch(file.url)).arrayBuffer());
      const meter = new LoudnessMeter(48000, 2); meter.push([audio.getChannelData(0), audio.getChannelData(1)], audio.length);
      // Capture the actual realtime branch (0.5 s blocks) and compare it
      // with windowed export and the MCP measurement, without MP3 loss.
      const live = await livePlanes(audio.length);
      const preview = new LoudnessMeter(48000, 2); preview.push(live, audio.length);
      await call("undo");
      details[preset] = { ok: Math.abs(m.integrated_lufs - meter.integrated()) < 1 && Math.abs(preview.integrated() - meter.integrated()) < 1 && JSON.stringify(ve.project()) === before, measured: m.integrated_lufs, exported: meter.integrated(), preview: preview.integrated() };
    }
    await liveCtx.close();
    // Robot's carrier has the same phase at an arbitrary pre-rolled window.
    await call("apply_voice_preset", { clip_ids: [id], preset: "robot" });
    const { renderMixWindow, mixPreroll } = await import("/src/engine/mixdown.ts");
    const whole = await renderMixWindow(ve.project(), 0, 6 * 48000, 48000, 2, mixPreroll(ve.project()));
    const part = await renderMixWindow(ve.project(), 3.117, 48000, 48000, 2, mixPreroll(ve.project()));
    let energy = 0, error = 0;
    for (let i = 0; i < 48000; i++) { const a = whole.getChannelData(0)[Math.round(3.117 * 48000) + i], b = part.getChannelData(0)[i]; energy += a * a; error += (a - b) ** 2; }
    details.phase = { ok: error / energy < 1e-4, errorDb: 10 * Math.log10(error / energy) };
    await call("apply_voice_preset", { clip_ids: [id], preset: "radio" });
    await call("normalize_loudness", { clip_ids: [id], target: -20 });
    const normalized = await call("measure_loudness", {});
    details.normalization = { ok: Math.abs(normalized.integrated_lufs + 20) < 0.3, measured: normalized.integrated_lufs };
    return details;
  }, id);
  const inspector = page.getByRole("region", { name: "Inspector" });
  await inspector.getByRole("tab", { name: "Audio" }).click();
  await inspector.getByRole("button", { name: "Chipmunk", exact: true }).click();
  details.chip = { ok: await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).pitch === 7, id) };
  await inspector.getByRole("button", { name: "None", exact: true }).click();
  details.none = { ok: await page.evaluate((id) => { const c = window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id); return !c.pitch && !c.voice && !c.ringMod && !c.highpass; }, id) };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undoChip = { ok: await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).voice === "chipmunk", id) };
  await page.setViewportSize({ width: 1100, height: 680 });
  await inspector.screenshot({ path: "scratch/voice-changer.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
}
