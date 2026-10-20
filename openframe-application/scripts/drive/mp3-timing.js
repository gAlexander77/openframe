// An MP3 plays where its sound is (ADR-112): the same 120 BPM kick, whose
// first hit starts at exactly 1.000 s, as PCM (onset-120.wav), LAME MP3
// and AAC. WebCodecs presents an MP3's encoder delay and padding (1105
// samples here, 25.06 ms at 44.1 kHz) that ffmpeg and gapless players
// leave out; the app now reads them from the LAME tag. Each file must
// land on the WAV, sample for sample: its length, its analysis decode,
// the export mix of a clip placed at 0.5 s, its waveform, and the beats
// analyze_music reads. Before the fix the MP3 read 12.042 s long and
// every path heard it 1105 samples late; AAC was already exact.
async (page) => {
  page.setDefaultTimeout(300000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const r = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args = {}) => {
      const res = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (res.error || res.result.isError) throw new Error(`${name}: ${res.error?.message ?? res.result.content[0].text}`);
      return JSON.parse(res.result.content.at(-1).text);
    };
    const { decodePcm } = await import("/src/engine/analyze.ts");
    const { renderMixWindow } = await import("/src/engine/mixdown.ts");
    const { thumbs, prepare } = await import("/src/engine/thumbs.ts");
    const d = await import("/src/lib/project/defaults.ts");
    const names = ["onset-120.wav", "onset-120.mp3", "onset-120.m4a"];
    const assets = await ve.import(names.map((n) => ({ name: n, src: `${location.origin}/fixtures/media/${n}` })));
    const rate = 44100;
    const out = {};
    for (const a of assets) {
      // The analysis decode (analyze_music, measure_loudness, preview_audio,
      // transcripts read through the same origin).
      const pcm = (await decodePcm(a, 0, 4)).channels[0];
      // The export mix, the playback scheduler's code: the clip at 0.5 s.
      const p = d.createProject({});
      const track = d.createTrack("audio", "A");
      track.clips = [d.clipForAsset(a, 15, p.fps)];
      p.assets = [a];
      p.tracks = [...p.tracks, track];
      const mix = (await renderMixWindow(p, 0, 4 * rate, rate, 1, 0)).getChannelData(0);
      // The waveform, 100 buckets a second.
      prepare(a);
      let peaks;
      for (let i = 0; i < 100 && !(peaks = thumbs.peaks(a))?.data.some((v, k) => k > 300 && v > 0); i++) await new Promise((w) => setTimeout(w, 100));
      out[a.name] = { duration: a.duration, gapless: a.gapless ?? null, pcm, mix, peaks: peaks ? Array.from(peaks.data.subarray(0, 400)) : null };
    }
    // analyze_music on a clip of each, every beat listed.
    for (const a of assets) {
      const t = (await call("add_track", { kind: "audio", name: a.name })).added_tracks[0].id;
      const clip = (await call("add_media_clip", { asset_id: a.id, start: 0, track_id: t })).added_clips[0].id;
      const m = await call("analyze_music", { clip_id: clip, bpm: 120, detail: "full" });
      out[a.name].beats = m.beats;
    }
    // Lag of `b` against `a` (samples), by cross-correlation over 0.3-3.7 s.
    const lagOf = (a, b) => {
      let best = { lag: 0, r: -2 };
      for (let lag = -2000; lag <= 2000; lag++) {
        let s = 0, sa = 0, sb = 0;
        for (let i = 13230; i < 163170; i += 3) {
          const x = a[i], y = b[i + lag] ?? 0;
          s += x * y; sa += x * x; sb += y * y;
        }
        const rr = s / Math.sqrt(sa * sb || 1);
        if (rr > best.r) best = { lag, r: rr };
      }
      return { lag: best.lag, r: +best.r.toFixed(4) };
    };
    // The first sample at half the kick's level: its attack.
    const onset = (x) => x.findIndex((v) => Math.abs(v) > 0.4);
    const wav = out["onset-120.wav"];
    const res = {};
    for (const n of names) {
      const f = out[n];
      res[n] = {
        duration: f.duration,
        gapless: f.gapless,
        pcmLag: lagOf(wav.pcm, f.pcm),
        mixLag: lagOf(wav.mix, f.mix),
        pcmOnset: onset(f.pcm),
        mixOnset: onset(f.mix),
        peakOnset: f.peaks ? f.peaks.findIndex((v) => v > 0.4) : null,
        beatDiffMs: f.beats && wav.beats ? +Math.max(...f.beats.slice(0, 20).map((b, i) => Math.abs(b - wav.beats[i]) * 1000)).toFixed(2) : null,
        beats: f.beats?.slice(0, 4),
      };
    }
    return res;
  });
  const details = {};
  for (const [n, f] of Object.entries(r)) {
    details[n] = {
      // 12 s exactly (529200 samples); the MP3 read 12.042 before.
      ok: Math.abs(f.duration - 12) < 0.0005
        // Lined up with the WAV to the sample, through decode and the mix.
        && f.pcmLag.lag === 0 && f.pcmLag.r > 0.99 && f.mixLag.lag === 0 && f.mixLag.r > 0.99
        // The first hit at 1.000 s in the file (sample 44100) and at 1.500 s
        // on the timeline (clip at 0.5 s), within a millisecond.
        && Math.abs(f.pcmOnset - 44100) <= 44 && Math.abs(f.mixOnset - 66150) <= 44
        // The waveform rises in the bucket of 1.00 s (or the one before:
        // 44100 / 44100 can land a hair under the boundary).
        && Math.abs(f.peakOnset - 100) <= 1
        // analyze_music hears the first beat at 1.000 s and every beat
        // where the WAV's are, within 2 ms.
        && Math.abs(f.beats?.[0] - 1) <= 0.002 && f.beatDiffMs !== null && f.beatDiffMs <= 2,
      ...f,
    };
  }
  details.trimmed = { ok: r["onset-120.mp3"].gapless !== null && r["onset-120.wav"].gapless === null && r["onset-120.m4a"].gapless === null, mp3: r["onset-120.mp3"].gapless };
  return { ok: Object.values(details).every((x) => x.ok), details };
};
