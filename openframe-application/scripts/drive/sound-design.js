// Sound design and delivery, end to end through MCP only (ADR-060, 061):
// a 10 s sequence built with tools/call JSON-RPC, as an agent would. A
// drum bed whose low-pass sweep opens on the drop at 5 s, a synth bed and
// the drums tape-stopped over the last 1.5 s, a voice in a cathedral, an
// echo on a pop. Each effect is then measured in the rendered WAV, the
// track soloed through update_track: the drums' hi-hat band before and
// after 5 s, the synth's pitch through the stop against the stop's own
// time map, the reverb's tail after the voice ends (and none with it
// off), the pop's repeats. measure_loudness is checked against ebu_r128
// and online, and its figures against an independent reading of the
// exported WAV: LoudnessMeter, Tech 3342's LRA written out here, and a
// true peak from the browser's own resampler (decodeAudioData at 192 kHz).
// Exports at -10 and -24 must hold their true peak under -1 and -2 dBTP;
// a reverb tail must run on across the export's 10 s window edge; and a
// second of preview must play through the same graph without an error.
async (page) => {
  page.setDefaultTimeout(20000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // One MCP tools/call; the tool's JSON answer, or a throw with its message.
  const rpc = (name, args = {}) =>
    page.evaluate(
      async ([name, args]) => {
        const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: Math.random(), method: "tools/call", params: { name, arguments: args } });
        if (r.error) throw new Error(`${name}: ${r.error.message}`);
        const text = r.result.content[0].text;
        if (r.result.isError) throw new Error(`${name}: ${text}`);
        return JSON.parse(text);
      },
      [name, args],
    );
  const details = {};
  const t0 = Date.now();

  // ---- build, through MCP only ------------------------------------------------
  await rpc("new_project", { name: "Sound design drive" });
  await page.locator(".timeline-panel").waitFor();
  const origin = await page.evaluate(() => location.origin);
  const assets = await rpc("import_media", {
    files: ["beat-128.m4a", "music-30s.mp3", "voice-8s.wav"].map((n) => ({ src: `${origin}/fixtures/media/${n}`, name: n })),
  });
  const asset = (n) => assets.find((a) => a.name === n).id;
  const track = async (name) => (await rpc("add_track", { kind: "audio", name })).added_tracks[0].id;
  const tracks = { drums: await track("Drums"), synth: await track("Synth"), voice: await track("Voice"), sfx: await track("SFX") };
  const place = async (args) => (await rpc("add_media_clip", args)).added_clips[0].id;
  const drums = await place({ asset_id: asset("beat-128.m4a"), start: 0, duration: 10, track_id: tracks.drums });
  const synth = await place({ asset_id: asset("music-30s.mp3"), start: 0, duration: 10, track_id: tracks.synth });
  const voice = await place({ asset_id: asset("voice-8s.wav"), start: 1, duration: 3, track_id: tracks.voice });
  const pop = (await rpc("add_sound_effect", { name: "pop", start: 6 })).clip_id;
  await rpc("move_clip", { clip_id: pop, start: 6, track_id: tracks.sfx });
  // The trailer move: muffled build, open on the drop at 5 s.
  await rpc("set_audio_filter", { clip_ids: [drums, synth], type: "lowpass", cutoff: 300, sweep: { to: 20000, start: 4.5, end: 5 } });
  await rpc("set_reverb", { clip_ids: [voice], preset: "cathedral" });
  await rpc("set_echo", { clip_ids: [pop], time: 0.3, feedback: 0.5, mix: 0.5 });
  await rpc("set_tape_stop", { clip_ids: [drums, synth], duration: 1.5 });
  const described = await rpc("describe_project");
  const clipsById = Object.fromEntries(described.tracks.flatMap((t) => t.clips).map((c) => [c.id, c]));
  details.described = {
    ok: clipsById[drums].lowpass?.cutoff === 300 && JSON.stringify(clipsById[drums].keyframes?.["lowpass.cutoff"]) === "[[4.5,300],[5,20000]]" && clipsById[voice].reverb?.decay === 6 && clipsById[pop].echo?.time === 0.3 && clipsById[synth].tape_stop?.duration === 1.5 && described.duration === 10,
    drums: clipsById[drums],
  };
  const listed = await page.evaluate(async () => (await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools.map((t) => t.name));
  details.listed = { ok: ["set_audio_filter", "set_reverb", "set_echo", "set_tape_stop", "measure_loudness"].every((n) => listed.includes(n)) };

  // ---- analysis helpers in the page ---------------------------------------------
  await page.evaluate(() => {
    const wav = (buf) => {
      const v = new DataView(buf);
      const ch = v.getUint16(22, true), rate = v.getUint32(24, true);
      const n = Math.floor((buf.byteLength - 44) / 2 / ch);
      const planes = Array.from({ length: ch }, () => new Float32Array(n));
      for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) planes[c][i] = v.getInt16(44 + (i * ch + c) * 2, true) / 32768;
      return { planes, rate };
    };
    window.__sd = {
      async render(opts = {}) {
        const r = await window.videoEditor.render({ video: false, audioFormat: "wav", ...opts });
        const buf = await (await fetch(r.url)).arrayBuffer();
        URL.revokeObjectURL(r.url);
        return { ...wav(buf), buf, note: [r.info, r.note].filter(Boolean).join(" "), loudness: r.loudness ?? null };
      },
      rms(planes, rate, a, b) {
        let s = 0, n = 0;
        for (const p of planes) for (let i = Math.round(a * rate); i < Math.round(b * rate); i++, n++) s += p[i] * p[i];
        return Math.sqrt(s / Math.max(1, n));
      },
      // Energy above `hz`, through a 4th-order high-pass, RMS over [a, b).
      async band(planes, rate, hz, a, b) {
        const ctx = new OfflineAudioContext(1, planes[0].length, rate);
        const buffer = ctx.createBuffer(1, planes[0].length, rate);
        buffer.copyToChannel(planes[0], 0);
        const src = new AudioBufferSourceNode(ctx, { buffer });
        const f1 = new BiquadFilterNode(ctx, { type: "highpass", frequency: hz });
        const f2 = new BiquadFilterNode(ctx, { type: "highpass", frequency: hz });
        src.connect(f1).connect(f2).connect(ctx.destination);
        src.start();
        const out = await ctx.startRendering();
        return window.__sd.rms([out.getChannelData(0)], rate, a, b);
      },
      // Frequency of a tone from its zero crossings over [a, b).
      zcHz(planes, rate, a, b) {
        const x = planes[0];
        let crossings = 0;
        for (let i = Math.round(a * rate) + 1; i < Math.round(b * rate); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) crossings++;
        return crossings / 2 / (b - a);
      },
      async truePeakDb(buf) {
        const ctx = new OfflineAudioContext(2, 1, 192000);
        const up = await ctx.decodeAudioData(buf.slice(0));
        let m = 0;
        for (let c = 0; c < up.numberOfChannels; c++) for (const v of up.getChannelData(c)) m = Math.max(m, Math.abs(v));
        return 20 * Math.log10(m);
      },
    };
  });
  const solo = async (id) => {
    for (const [, t] of Object.entries(tracks)) await rpc("update_track", { track_id: t, solo: t === id });
  };

  // ---- the filter sweep: hi-hats (6 kHz and up) gone before 4.5 s, back after 5 s ----
  await solo(tracks.drums);
  details.filterSweep = await page.evaluate(async () => {
    const { planes, rate } = await window.__sd.render();
    const before = await window.__sd.band(planes, rate, 4000, 1, 4.4);
    const after = await window.__sd.band(planes, rate, 4000, 5.1, 8.4);
    const lows = window.__sd.rms(planes, rate, 1, 4.4);
    return { before, after, lows, gainDb: 20 * Math.log10(after / Math.max(before, 1e-9)) };
  });
  details.filterSweep.ok = details.filterSweep.gainDb > 30 && details.filterSweep.lows > 0.01;

  // ---- the tape stop: the synth's pitch follows rate x source pitch ------------
  await solo(tracks.synth);
  details.tapeStop = await page.evaluate(async () => {
    const { planes, rate } = await window.__sd.render();
    // The stop's own map (lib/soundFx tapeStopMap): from 8.5 s the speed
    // falls linearly to 0 at 10 s; the source tone is 220 + 110 * floor(t mod 4) Hz.
    const s = 8.5, n = 1.5;
    const speed = (u) => (u <= s ? 1 : Math.max(0, 1 - (u - s) / n));
    const warp = (u) => (u <= s ? u : u - (u - s) ** 2 / (2 * n));
    const tone = (t) => 220 + 110 * Math.floor(t % 4);
    const expected = (a, b) => {
      let acc = 0;
      for (let k = 0; k < 100; k++) {
        const u = a + ((k + 0.5) * (b - a)) / 100;
        acc += tone(warp(u)) * speed(u);
      }
      return acc / 100;
    };
    const windows = [[7.6, 7.9], [8.55, 8.75], [8.85, 9.05], [9.2, 9.4], [9.5, 9.7]];
    const rows = windows.map(([a, b]) => {
      const got = window.__sd.zcHz(planes, rate, a, b);
      const want = expected(a, b);
      return { at: a, got: +got.toFixed(1), want: +want.toFixed(1), speed: +(got / tone(warp((a + b) / 2))).toFixed(3) };
    });
    const loud = window.__sd.rms(planes, rate, 7.6, 8.4);
    const end = window.__sd.rms(planes, rate, 9.75, 9.95);
    return { rows, loud, end };
  });
  {
    const d = details.tapeStop;
    const speeds = d.rows.map((r) => r.speed);
    d.ok = d.rows.every((r) => Math.abs(r.got / r.want - 1) < 0.08) && speeds.every((v, i) => i === 0 || v < speeds[i - 1]) && d.end < 0.5 * d.loud;
  }

  // ---- the reverb: a tail after the voice ends at 4 s, none without it ----------
  await solo(tracks.voice);
  const tail = () =>
    page.evaluate(async () => {
      const { planes, rate } = await window.__sd.render();
      return { voice: window.__sd.rms(planes, rate, 3.1, 3.9), early: window.__sd.rms(planes, rate, 4.05, 4.55), late: window.__sd.rms(planes, rate, 5.5, 6) };
    });
  const wet = await tail();
  await rpc("set_reverb", { clip_ids: [voice], off: true });
  const dry = await tail();
  await rpc("undo");
  details.reverb = { ok: wet.early > 0.02 && wet.late < wet.early && wet.late > 0.002 && dry.early < 1e-3, wet, dry, restored: (await rpc("describe_project")).tracks.flatMap((t) => t.clips).find((c) => c.id === voice).reverb?.decay };
  details.reverb.ok &&= details.reverb.restored === 6;

  // ---- the echo: the pop at 6 s repeats at 6.3 and 6.6, each half the last ----
  await solo(tracks.sfx);
  details.echo = await page.evaluate(async () => {
    const { planes, rate } = await window.__sd.render();
    const r = (a, b) => window.__sd.rms(planes, rate, a, b);
    return { pop: r(6, 6.15), gap: r(6.17, 6.28), first: r(6.3, 6.45), second: r(6.6, 6.75), third: r(6.9, 7.05) };
  });
  {
    const d = details.echo;
    d.ok = d.pop > 0.01 && d.first / d.pop > 0.6 && d.first / d.pop < 1.4 && d.second / d.first > 0.35 && d.second / d.first < 0.7 && d.third < d.second && d.gap < 0.1 * d.pop;
  }
  for (const t of Object.values(tracks)) await rpc("update_track", { track_id: t, solo: false });

  // ---- measure_loudness against the specs, and an independent reading --------
  // As built, the four beds sum past full scale: the report must say so.
  const hot = await rpc("measure_loudness", { spec: "online" });
  details.clipping = { ok: hot.clips === true && hot.sample_peak_dbfs > 0 && hot.pass === false, sample_peak_dbfs: hot.sample_peak_dbfs };
  // Mixed down, the file holds what the report measured.
  await rpc("update_track", { track_id: tracks.drums, volume: 0.35 });
  await rpc("update_track", { track_id: tracks.synth, volume: 0.35 });
  await rpc("update_track", { track_id: tracks.voice, volume: 0.6 });
  const measuredAt = Date.now();
  const r128 = await rpc("measure_loudness", { spec: "ebu_r128" });
  const measureMs = Date.now() - measuredAt;
  const online = await rpc("measure_loudness", { spec: "online" });
  const all = await rpc("measure_loudness", {});
  const independent = await page.evaluate(async () => {
    const { LoudnessMeter } = await import("/src/lib/analysis/loudness.ts");
    const { planes, rate, buf } = await window.__sd.render();
    const m = new LoudnessMeter(rate, planes.length);
    m.push(planes, planes[0].length);
    const lufs = (ms) => -0.691 + 10 * Math.log10(ms);
    const windowed = (n) => m.steps.slice(n - 1).map((_, i) => lufs(m.steps.slice(i, i + n).reduce((a, b) => a + b, 0) / n));
    const st = windowed(30);
    // EBU Tech 3342's reference algorithm, as its MATLAB listing has it.
    const abs = st.filter((l) => l >= -70);
    const rel = abs.filter((l) => l >= 10 * Math.log10(abs.reduce((s, l) => s + 10 ** (l / 10), 0) / abs.length) - 20).sort((a, b) => a - b);
    const pct = (p) => rel[Math.round(((rel.length - 1) * p) / 100)];
    return { integrated: m.integrated(), shortTermMax: Math.max(...st), momentaryMax: Math.max(...windowed(4)), range: pct(95) - pct(10), truePeak: await window.__sd.truePeakDb(buf) };
  });
  const near = (a, b, tol) => a !== null && Math.abs(a - b) <= tol;
  const pass = (rep, target, tol, tp) => Math.abs(rep.integrated_lufs - target) <= tol && rep.true_peak_dbtp <= tp;
  details.report = {
    ok:
      near(r128.integrated_lufs, independent.integrated, 0.2) &&
      near(r128.short_term_max_lufs, independent.shortTermMax, 0.2) &&
      near(r128.momentary_max_lufs, independent.momentaryMax, 0.2) &&
      near(r128.loudness_range_lu, independent.range, 0.5) &&
      near(r128.true_peak_dbtp, independent.truePeak, 0.3) &&
      r128.true_peak_dbtp >= r128.sample_peak_dbfs &&
      r128.clips === undefined &&
      r128.pass === pass(r128, -23, 0.5, -1) &&
      online.pass === pass(online, -14, 1, -1) &&
      (r128.pass || r128.problems.length > 0) &&
      all.specs.ebu_r128.pass === r128.pass &&
      all.specs.online.pass === online.pass,
    measureMs,
    r128,
    online: { pass: online.pass, problems: online.problems },
    independent,
  };

  // ---- as exported: the report's loudness option, and real exports ------------
  const asR128 = await rpc("measure_loudness", { spec: "ebu_r128", loudness: -23 });
  const asAtsc = await rpc("measure_loudness", { spec: "atsc_a85", loudness: -24 });
  details.asExported = { ok: asR128.pass && near(asR128.integrated_lufs, -23, 0.5) && asR128.true_peak_dbtp <= -1 && asAtsc.pass && asAtsc.true_peak_dbtp <= -2, asR128, asAtsc };
  const exported = async (loudness) =>
    page.evaluate(async (loudness) => {
      const { LoudnessMeter } = await import("/src/lib/analysis/loudness.ts");
      const { planes, rate, buf, note, loudness: reached } = await window.__sd.render({ loudness });
      const m = new LoudnessMeter(rate, planes.length);
      m.push(planes, planes[0].length);
      return { lufs: m.integrated(), truePeak: await window.__sd.truePeakDb(buf), note, reached };
    }, loudness);
  const loud = await exported(-10);
  const atsc = await exported(-24);
  details.truePeakHeld = {
    ok: loud.truePeak <= -1 + 0.15 && /limiter held the peaks under -1 dBTP/.test(loud.note) && loud.reached.truePeak <= -1 && near(atsc.lufs, -24, 0.5) && atsc.truePeak <= -2 + 0.15,
    loud,
    atsc,
  };

  // ---- a tail across an export window edge (10 s): pre-roll carries it -------
  // A second voice ends at 9.8 s in the cathedral; a pop at 12.5 s makes a
  // second 10 s window. Without pre-roll that window would open silent.
  const voice2 = await place({ asset_id: asset("voice-8s.wav"), start: 7, duration: 2.8, in: 2, track_id: tracks.voice });
  await rpc("set_reverb", { clip_ids: [voice2], preset: "cathedral" });
  await rpc("add_sound_effect", { name: "pop", start: 12.5 });
  await solo(tracks.voice);
  details.windowEdge = await page.evaluate(async () => {
    const { planes, rate } = await window.__sd.render();
    const r = (a, b) => window.__sd.rms(planes, rate, a, b);
    return { seconds: planes[0].length / rate, before: r(9.9, 10), after: r(10, 10.1), later: r(11, 11.1) };
  });
  {
    const d = details.windowEdge;
    d.ok = d.seconds > 12.5 && d.after > 0.02 && Math.abs(d.after / d.before - 1) < 0.15 && d.later < d.after;
  }
  for (const t of Object.values(tracks)) await rpc("update_track", { track_id: t, solo: false });

  // ---- the same graph plays: a second of preview through the sweep -----------
  await page.evaluate(() => window.videoEditor.seek(4 * 30));
  // A key press is a user gesture, which the AudioContext needs to start.
  await page.keyboard.press("Space");
  await page.waitForTimeout(1500);
  const heard = await page.evaluate(async () => {
    const audioUrl = performance.getEntriesByType("resource").map((e) => e.name).find((u) => /\/src\/engine\/audio\.ts(\?|$)/.test(u));
    const { masterBus, peakDb } = await import(audioUrl);
    const levels = [];
    for (let i = 0; i < 6; i++) {
      levels.push(Math.max(peakDb(masterBus().left), peakDb(masterBus().right)));
      await new Promise((r) => setTimeout(r, 100));
    }
    return { playing: window.videoEditor.state().playing, levels: levels.map((l) => +l.toFixed(1)) };
  });
  await page.keyboard.press("Space");
  details.preview = { ok: heard.playing && heard.levels.some((l) => l > -40) && errors.length === 0, ...heard, errors };
  details.seconds = { ok: true, took: Math.round((Date.now() - t0) / 1000) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
