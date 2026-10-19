// generate_music, every style, through the MCP surface an agent uses: each
// score in a project of its own, 60 s with stems and markers, then measured
// as a mastering engineer and an editor would check it, since nobody here
// can listen:
// - measure_loudness on the timeline: -14 LUFS within 0.5 LU, true peak
//   at most -1 dBTP; PLR (peak to loudness) 8..13.5 (SOS: under 8 is
//   squashed; online services keep about 12-13 of headroom);
// - the WAV files read back: no sample at full scale, no DC, the four stems
//   adding up to the mix within the 16-bit dither (a few steps);
// - analyze_music on the placed clip finds the tempo (2%: its estimate runs
//   a little fast on ambient's soft pulse), every drop the
//   cue sheet names (within a bar) and every section start (within a bar)
//   but a ring-out outro's (no onsets: it reads as the last drop's tail);
// - spectral balance against the ranges in docs/research/Music generation
//   2026-10-19.md: the slope of the octave bands 125 Hz-4 kHz (commercial
//   mixes average -4.5 dB an octave; dance mixes run brighter), the power
//   below 250 Hz and above 4 kHz, crest factor in the drops and stereo
//   correlation;
// - the launch style at 68 s in the third launch film's form (drops at 8
//   and 40 s, the final hit at 60) sits in the same ranges at its default
//   brightness, and brightness -1 and 1 tilt it each way with the
//   loudness and true peak held;
// - plan_music with the same arguments answers the same cue sheet.
async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  page.setDefaultTimeout(180000);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const results = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.result.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
      return JSON.parse(r.result.content[0].text);
    };
    const platformUrl = performance.getEntriesByType("resource").map((e) => e.name).find((n) => /\/src\/platform\/index\.ts(\?|$)/.test(n));
    const { platform } = await import(platformUrl);
    const { balance, stats } = await import("/src/lib/music/measure.ts");
    const read = async (assetId) => {
      const a = ve.project().assets.find((x) => x.id === assetId);
      const buf = await (await platform.blobFor(a.src)).arrayBuffer();
      const v = new DataView(buf);
      const ch = v.getUint16(22, true), rate = v.getUint32(24, true);
      const n = Math.floor((buf.byteLength - 44) / 2 / ch);
      const planes = Array.from({ length: ch }, () => new Float32Array(n));
      for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) planes[c][i] = v.getInt16(44 + (i * ch + c) * 2, true) / 32768;
      return { planes, rate };
    };
    const out = {};
    for (const style of ["launch", "cinematic", "corporate", "lofi", "ambient"]) {
      await call("new_project", { name: `Generated ${style}` });
      const args = { style, seed: 7, length: 60, stems: true, markers: ["bars", "sections", "drop"] };
      const t0 = performance.now();
      const g = await call("generate_music", args);
      const seconds = (performance.now() - t0) / 1000;
      const plan = await call("plan_music", { style, seed: 7, length: 60 });
      const loud = await call("measure_loudness", { spec: "online" });
      const an = await call("analyze_music", { clip_id: g.clip_id });
      const mix = await read(g.asset_id);
      const stems = await Promise.all(["drums", "bass", "harmony", "lead"].map((s) => read(g.stems[s].asset_id)));
      const [L, R] = mix.planes;
      let worst = 0;
      for (let i = 0; i < L.length; i++) {
        for (const c of [0, 1]) {
          const sum = stems.reduce((a, s) => a + s.planes[c][i], 0);
          worst = Math.max(worst, Math.abs(sum - mix.planes[c][i]));
        }
      }
      // Crest factor in the drops: peak over RMS where the piece is fullest.
      let peak = 0, ss = 0, cnt = 0;
      for (const s of g.sections.filter((x) => x.role === "drop")) {
        for (let i = Math.round(s.start * mix.rate); i < Math.min(L.length, Math.round(s.end * mix.rate)); i++) {
          peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
          ss += L[i] * L[i] + R[i] * R[i];
          cnt += 2;
        }
      }
      const b = balance(L, R, mix.rate);
      const st = stats(L, R);
      const markers = ve.project().markers.map((m) => m.label);
      const spec = loud.specs?.online ?? loud;
      out[style] = {
        seconds: +seconds.toFixed(1),
        bpm: g.bpm, key: g.key, progression: g.progression, duration: g.duration,
        sections: g.sections.map((s) => `${s.role}@${s.start}`),
        drops: g.drops, final_hit: g.final_hit,
        measured: g.measured,
        loudness: { integrated: loud.integrated_lufs, true_peak: loud.true_peak_dbtp, pass: loud.pass },
        analysis: { bpm: an.bpm, drops: an.drops, sections: an.sections.map((s) => `${s.label}@${s.start}`) },
        stems_worst: worst,
        crest_drops_db: +(20 * Math.log10(peak / Math.sqrt(ss / Math.max(1, cnt)))).toFixed(2),
        balance: { low: b.low, mid: b.mid, high: b.high, slope: b.slope, octaves: b.octaves.map((o) => o.db) },
        correlation: st.correlation, dc: st.dc, clipped: st.clipped,
        markers: { bars: markers.filter((m) => m === "Bar").length, drops: markers.filter((m) => m === "Drop").length, sections: markers.filter((m) => !["Bar", "Drop"].includes(m)).length },
        plan_matches: JSON.stringify(plan.sections) === JSON.stringify(g.sections) && plan.bpm === g.bpm && JSON.stringify(plan.drops) === JSON.stringify(g.drops),
        bar: g.bar,
        spec,
      };
    }
    // The film's form at 68 s, at the default brightness and at both ends.
    const film = [{ name: "intro", bars: 4 }, { name: "drop", at: 8, bars: 8 }, { name: "breakdown", bars: 4 }, { name: "build", bars: 4 }, { name: "drop", at: 40 }, { name: "outro", at: 60, end_at: 68 }];
    out.film = {};
    for (const brightness of [undefined, -1, 1]) {
      await call("new_project", { name: `Film form ${brightness ?? "default"}` });
      const g = await call("generate_music", { style: "launch", seed: 7, key: "F", mode: "minor", sections: film, place: "none", ...(brightness === undefined ? {} : { brightness }) });
      out.film[brightness ?? "default"] = { duration: g.duration, measured: g.measured };
    }
    // Fitting an edit: an intro of four bars, a drop at 8.4 s (between bar
    // lines at 120 BPM) and an outro ending exactly at 56 s.
    out.fit = await call("plan_music", { style: "launch", seed: 3, sections: [{ name: "intro", bars: 4 }, { name: "drop", at: 8.4, bars: 8 }, { name: "breakdown", bars: 4 }, { name: "drop", bars: 8 }, { name: "outro", end_at: 56 }] });
    return out;
  });
  const fit = results.fit;
  delete results.fit;
  const film = results.film;
  delete results.film;

  // Acceptance ranges per style (the research note gives the reasons).
  const RANGES = {
    launch: { slope: [-4.5, -0.5], low: [0.5, 0.9], high: [0.018, 0.045] },
    cinematic: { slope: [-5, -0.5], low: [0.35, 0.85], high: [0.004, 0.03] },
    corporate: { slope: [-4.5, -0.5], low: [0.4, 0.85], high: [0.01, 0.04] },
    lofi: { slope: [-6, -1.5], low: [0.4, 0.85], high: [0, 0.01] },
    ambient: { slope: [-4, 1], low: [0.2, 0.7], high: [0.001, 0.02] },
  };
  const details = {};
  for (const [style, r] of Object.entries(results)) {
    const bar = r.bar;
    const near = (a, b) => Math.abs(a - b) <= bar + 0.02;
    const plr = r.loudness.true_peak - r.loudness.integrated;
    const range = RANGES[style];
    details[`${style}: loudness`] = { ok: Math.abs(r.loudness.integrated + 14) <= 0.5 && r.loudness.true_peak <= -0.95, integrated: r.loudness.integrated, true_peak: r.loudness.true_peak };
    details[`${style}: PLR`] = { ok: plr >= 8 && plr <= 13.5, plr: +plr.toFixed(2) };
    details[`${style}: clean`] = { ok: r.clipped === 0 && r.dc.every((d) => Math.abs(d) < 1e-4), clipped: r.clipped, dc: r.dc };
    details[`${style}: stems add up`] = { ok: r.stems_worst <= 8 / 32768, worst: r.stems_worst };
    details[`${style}: tempo`] = { ok: Math.abs(r.analysis.bpm / r.bpm - 1) < 0.02, bpm: r.bpm, found: r.analysis.bpm };
    details[`${style}: drops`] = { ok: r.analysis.drops.length === r.drops.length && r.drops.every((d, i) => near(d, r.analysis.drops[i])), planned: r.drops, found: r.analysis.drops };
    // Every section start but a ring-out outro's: its final chord rings with
    // no onsets for analyze_music's beat tracker, which hears it as the end
    // of the drop before (docs/research/Music generation 2026-10-19.md).
    const starts = r.sections.slice(1).filter((s) => !s.startsWith("outro")).map((s) => +s.split("@")[1]);
    const found = r.analysis.sections.map((s) => +s.split("@")[1]);
    details[`${style}: sections`] = { ok: starts.every((t) => found.some((f) => near(f, t))), planned: r.sections, found: r.analysis.sections };
    details[`${style}: spectrum`] = { ok: r.balance.slope >= range.slope[0] && r.balance.slope <= range.slope[1] && r.balance.low >= range.low[0] && r.balance.low <= range.low[1] && r.balance.high >= range.high[0] && r.balance.high <= range.high[1], ...r.balance };
    details[`${style}: crest and width`] = { ok: r.crest_drops_db >= 8 && r.crest_drops_db <= 16 && r.correlation >= 0.3 && r.correlation <= 0.98, crest_drops_db: r.crest_drops_db, correlation: r.correlation };
    // A drop section's marker and its Drop marker share a label and a time: one marker.
    details[`${style}: markers`] = { ok: r.markers.bars > 10 && r.markers.drops === r.sections.filter((x) => x.startsWith("drop")).length && r.markers.sections === r.sections.filter((x) => !x.startsWith("drop")).length, ...r.markers };
    details[`${style}: plan_music agrees`] = { ok: r.plan_matches };
    details[`${style}: render time`] = { ok: r.seconds < 60, seconds: r.seconds, key: r.key, progression: r.progression };
  }
  const L = RANGES.launch, m = film.default.measured;
  details["launch at 68 s in the film's form: in range at the default brightness"] = {
    ok: film.default.duration === 68 && m.brightness === 0.4 && m.slope_db_per_octave >= L.slope[0] && m.slope_db_per_octave <= L.slope[1] && m.low >= L.low[0] && m.low <= L.low[1] && m.high >= L.high[0] && m.high <= L.high[1] && Math.abs(m.lufs + 14) <= 0.1 && m.true_peak_dbtp <= -0.95,
    ...m,
  };
  const [dark, bright] = [film[-1].measured, film[1].measured];
  details["brightness tilts it each way, loudness and true peak held"] = {
    ok: dark.high < m.high && m.high < bright.high && dark.low > m.low && m.low > bright.low && [dark, bright].every((x) => Math.abs(x.lufs + 14) <= 0.1 && x.true_peak_dbtp <= -0.95),
    high: [dark.high, m.high, bright.high],
    low: [dark.low, m.low, bright.low],
    lufs: [dark.lufs, m.lufs, bright.lufs],
    true_peak: [dark.true_peak_dbtp, m.true_peak_dbtp, bright.true_peak_dbtp],
  };
  const drop = fit.sections.find((x) => x.role === "drop");
  details["fit: drop at 8.4 s, end at 56 s"] = { ok: fit.fit.ok && Math.abs(drop.start - 8.4) < 0.01 && fit.duration === 56 && Math.abs(fit.sections.at(-1).end - 56) < 1e-9, bpm: fit.bpm, nudge: fit.fit.nudge, targets: fit.fit.targets, note: fit.fit.note };
  return { ok: Object.values(details).every((d) => d.ok), details };
}
