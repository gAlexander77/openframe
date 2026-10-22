// Speech plus synthesized room tone, then calibrated sibilance/EQ tones.
// All edits use MCP; measurements read back the actual exported WAV.
async (page) => {
  page.setDefaultTimeout(180000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  return page.evaluate(async () => {
    const ve = window.videoEditor, rate = 48000;
    const call = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: Math.random(), method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(JSON.stringify(r)); return JSON.parse(r.result.content.at(-1).text);
    };
    const decode = async bytes => new OfflineAudioContext(2, 1, rate).decodeAudioData(bytes);
    const render = async () => {
      const file = await ve.render({ video: false, audioFormat: "wav", loudness: null });
      try { const bytes = await (await fetch(file.url)).arrayBuffer(); return { bytes, audio: await decode(bytes.slice(0)) }; }
      finally { URL.revokeObjectURL(file.url); }
    };
    const { platform } = await import("/src/platform/index.ts");
    const { encodeWav } = await import("/src/lib/wav.ts");
    const importWav = async (name, bytes) => {
      const files = await platform.adoptFiles([new File([bytes], name, { type: "audio/wav" })]);
      const [asset] = await ve.import(files); return asset;
    };
    const add = async asset => {
      const r = await call("add_media_clip", { asset_id: asset.id, start: 0 }); return r.added_clips[0].id;
    };
    const energy = (x, from, to) => {
      // Decimal seconds (2.7 * 48000, for example) need integer indices.
      from = Math.round(from); to = Math.round(to);
      if (from < 0 || to > x.length || to <= from) throw new Error(`Energy window ${from}-${to} outside ${x.length} samples`);
      let e = 0; for (let i = from; i < to; i++) e += x[i] ** 2; return e / (to - from);
    };
    const db = e => 10 * Math.log10(Math.max(1e-20, e));
    const details = {};
    const [speech] = await ve.import([{ name: "speech-gaps.m4a", src: `${location.origin}/fixtures/media/speech-gaps.m4a` }]);
    if (!speech) throw new Error("speech-gaps.m4a fixture is required");
    await add(speech);
    const clean = (await render()).audio;
    await call("add_ambience", { name: "roomTone", start: 0, length: clean.duration, fade_in: 0, fade_out: 0, seed: 3 });
    const noisy = await render();
    await call("new_project", { name: "Gate a noisy interview" });
    const noisyAsset = await importWav("noisy-interview.wav", noisy.bytes);
    const voice = await add(noisyAsset);
    const before = (await render()).audio;
    // Put the threshold above the measured room tone, rather than assuming
    // one RMS-to-peak ratio for every ambience seed and fixture version.
    let noisePeak = 0;
    const cleanSamples = clean.getChannelData(0), noisySamples = before.getChannelData(0);
    for (let n = 0; n + rate / 20 < cleanSamples.length; n += rate / 20) {
      if (Math.sqrt(energy(cleanSamples, n, n + rate / 20)) >= 0.0005) continue;
      for (let i = n; i < n + rate / 20; i++) noisePeak = Math.max(noisePeak, Math.abs(noisySamples[i]));
    }
    const threshold = Math.max(-50, Math.min(-20, 20 * Math.log10(Math.max(noisePeak, 0.0001)) + 6));
    await call("set_dynamics", { clip_id: voice, gate: { threshold, ratio: 100, attack: 0.0005, hold: 0.03, release: 0.015, range: 24 } });
    const after = (await render()).audio;
    const x = clean.getChannelData(0), a = before.getChannelData(0), b = after.getChannelData(0), hop = rate / 20;
    let quietFor = 0, gapBefore = 0, gapAfter = 0, wordBefore = 0, wordAfter = 0, gaps = 0, words = 0;
    for (let n = 0; n + hop < x.length; n += hop) {
      const speechRms = Math.sqrt(energy(x, n, n + hop));
      quietFor = speechRms < 0.0005 ? quietFor + 0.05 : 0;
      if (quietFor > 0.35) { gapBefore += energy(a, n, n + hop); gapAfter += energy(b, n, n + hop); gaps++; }
      if (speechRms > Math.max(0.04, 10 ** (threshold / 20) * 1.3) && n > rate / 10 && Math.sqrt(energy(x, n - rate / 20, n)) > 0.02) { wordBefore += energy(a, n, n + hop); wordAfter += energy(b, n, n + hop); words++; }
    }
    const gapChange = db(gapAfter / gapBefore), wordChange = db(wordAfter / wordBefore);
    details.gateGaps = { ok: gaps >= 4 && Math.abs(gapChange + 24) < 4, gapChange, gaps, threshold };
    details.wordsPass = { ok: words >= 4 && Math.abs(wordChange) < 0.6, wordChange, words };
    const described = await call("describe_project");
    details.described = { ok: described.tracks.flatMap(t => t.clips).find(c => c.id === voice).dynamics[0].type === "gate" };

    await call("new_project", { name: "Calibrated de-esser and parametric EQ" });
    const tones = Float32Array.from({ length: rate * 4 }, (_, n) => 0.25 * Math.sin(2 * Math.PI * (n < rate * 2 ? 1000 : 7000) * n / rate));
    const toneAsset = await importWav("sibilance-tones.wav", encodeWav([tones], rate));
    const tone = await add(toneAsset);
    const dry = (await render()).audio.getChannelData(0).slice();
    const p = ve.project(), clip = p.tracks.flatMap(t => t.clips).find(c => c.id === tone);
    const clipSeconds = clip.duration * p.fps.den / p.fps.num;
    details.toneSpan = { ok: Math.abs(toneAsset.duration - 4) < 1 / rate && Math.abs(clipSeconds - 4) < 1 / rate && dry.length === rate * 4,
      importedSeconds: toneAsset.duration, clipSeconds, renderedSeconds: dry.length / rate };
    await call("set_dynamics", { clip_id: tone, deesser: { low: 5000, high: 9000, amount: 8 } });
    const ess = (await render()).audio.getChannelData(0).slice();
    const ratio = (next, prev, from, to) => {
      const before = energy(prev, from * rate, to * rate), after = energy(next, from * rate, to * rate);
      if (!(before > 0) || !Number.isFinite(after)) throw new Error(`Invalid tone energy at ${from}-${to} s: ${before}, ${after}`);
      return db(after / before);
    };
    const low = ratio(ess, dry, 0.7, 1.7), high = ratio(ess, dry, 2.7, 3.7);
    details.deesser = { ok: Math.abs(low) < 0.3 && high < -6, lowDb: low, highDb: high };
    await call("set_dynamics", { clip_id: tone, deesser: { on: false }, eq: { bands: [{ type: "peaking", freq: 1000, gain: 6, q: 2, on: true }] } });
    const eqAudio = (await render()).audio, eq = eqAudio.getChannelData(0);
    const boost = ratio(eq, dry, 0.7, 1.7), away = ratio(eq, dry, 2.7, 3.7);
    details.eq = { ok: Math.abs(boost - 6) < 0.15 && Math.abs(away) < 0.3, boostDb: boost, awayDb: away };
    const { LoudnessMeter } = await import("/src/lib/analysis/loudness.ts");
    const meter = new LoudnessMeter(rate, 2); meter.push([eqAudio.getChannelData(0), eqAudio.getChannelData(1)], eqAudio.length);
    const report = await call("measure_loudness");
    details.measurement = { ok: Math.abs(report.integrated_lufs - meter.integrated()) < 0.15, exportedLufs: meter.integrated(), reportedLufs: report.integrated_lufs };

    // Capture the actual live graph, with the same exported settings.
    const ctx = new AudioContext({ sampleRate: rate }); await ctx.resume();
    try {
      const url = URL.createObjectURL(new Blob([`registerProcessor("capture-dynamics", class extends AudioWorkletProcessor {
        constructor(o) { super(); this.start = o.processorOptions.start; this.length = o.processorOptions.length; this.data = [new Float32Array(this.length), new Float32Array(this.length)]; }
        process(inputs) {
          for (let n = 0; n < 128; n++) { const i = currentFrame + n - this.start; if (i >= 0 && i < this.length) for (let ch = 0; ch < 2; ch++) this.data[ch][i] = inputs[0]?.[ch]?.[n] ?? 0; }
          if (currentFrame + 128 >= this.start + this.length) { this.port.postMessage(this.data, this.data.map(x => x.buffer)); return false; } return true;
        }
      });`], { type: "text/javascript" }));
      await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      const at = Math.ceil((ctx.currentTime + 0.5) * rate) / rate;
      const tap = new AudioWorkletNode(ctx, "capture-dynamics", { channelCount: 2, channelCountMode: "explicit", processorOptions: { start: Math.round(at * rate), length: eqAudio.length } });
      tap.connect(ctx.destination);
      const captured = new Promise(resolve => { tap.port.onmessage = e => resolve(e.data); });
      const { scheduleAudio } = await import("/src/engine/audio.ts");
      const run = scheduleAudio(ctx, tap, ve.project(), 0, eqAudio.duration, at);
      try {
        const live = await captured;
        const m = new LoudnessMeter(rate, 2); m.push(live, eqAudio.length);
        details.liveParity = { ok: Math.abs(m.integrated() - meter.integrated()) < 0.2, liveLufs: m.integrated(), exportLufs: meter.integrated() };
      } finally { run.stop(); await run.done; tap.disconnect(); }
    } finally { await ctx.close(); }
    return { ok: Object.values(details).every(d => d.ok), details };
  });
}
