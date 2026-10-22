// A split of a compressed sound plays as the clip did whole (ADR-117):
// the two halves of a split share one EQ and compressor, so the second
// half's compressor starts where the first left off instead of with no
// gain reduction (24-40 dB under the signal for about 10 ms, ADR-107).
// Rendered as export renders the mix (renderMixWindow), the split against
// the unsplit clip, through window.videoEditor.mcp as an agent edits:
// a song with the strong preset, a speech take with the voice preset and
// an EQ, and halves whose compressors differ (two compressors: the second
// still starts fresh, as two clips do).
async (page) => {
  page.setDefaultTimeout(180000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  return page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? r.result.content[0].text}`);
      return JSON.parse(r.result.content.at(-1).text);
    };
    const { renderMixWindow, mixPreroll } = await import("/src/engine/mixdown.ts");
    const rate = 48000;
    const mix = async (from, to) => {
      const p = ve.project();
      return (await renderMixWindow(p, from, Math.round((to - from) * rate), rate, 2, mixPreroll(p))).getChannelData(0).slice();
    };
    const db = (e) => +(10 * Math.log10(e + 1e-15)).toFixed(1);
    /** The split's render against the whole clip's around the cut at `at`:
     * the error's peak 1 ms level under the signal's level there, and how
     * long the error stays within 60 dB of the signal. */
    const against = (whole, split, at, from) => {
      const c = Math.round((at - from) * rate), ms = rate / 1000;
      let sig = 0;
      for (let i = c - 50 * ms; i < c + 50 * ms; i++) sig += whole[i] * whole[i];
      sig /= 100 * ms;
      let worst = 0, loud = 0;
      for (let k = -20; k < 40; k++) {
        let e = 0;
        for (let i = c + k * ms; i < c + (k + 1) * ms; i++) e += (split[i] - whole[i]) ** 2;
        e /= ms;
        worst = Math.max(worst, e);
        if (e > sig * 1e-6) loud++;
      }
      return { errorUnderSignalDb: db(sig) - db(worst), msOver60: loud, signalDb: db(sig) };
    };
    const details = {};
    const [song, voice] = await ve.import(["music-stereo.m4a", "speech-test.wav"].map((n) => ({ name: n, src: `${location.origin}/fixtures/media/${n}` })));
    const track = async (name) => (await call("add_track", { kind: "audio", name })).added_tracks[0].id;
    const clipIds = () => ve.describe().tracks.flatMap((t) => t.clips).map((c) => c.id);
    const mute = (id, muted) => call("update_track", { track_id: id, muted });

    // A song, strongly compressed, split at 3 s.
    const t1 = await track("Song");
    const a = (await call("add_media_clip", { asset_id: song.id, start: 0, duration: 6, track_id: t1 })).added_clips[0].id;
    await call("set_compressor", { clip_ids: [a], preset: "strong" });
    const whole = await mix(2, 4);
    await call("split", { clip_ids: [a], at: 3 });
    const split = await mix(2, 4);
    details.song = { ...against(whole, split, 3, 2) };
    details.song.ok = details.song.errorUnderSignalDb > 60;
    // Halves with different compressors stay two compressors.
    const b = clipIds().find((id) => id !== a && ve.describe().tracks.find((t) => t.id === t1).clips.some((c) => c.id === id));
    await call("set_compressor", { clip_ids: [b], threshold: -30 });
    const apart = await mix(2, 4);
    details.differ = { ...against(whole, apart, 3, 2) };
    details.differ.ok = details.differ.errorUnderSignalDb < 40;
    await mute(t1, true);

    // A voice with an EQ and the voice preset, split mid-word.
    const t2 = await track("Voice");
    const v = (await call("add_media_clip", { asset_id: voice.id, start: 0, track_id: t2 })).added_clips[0].id;
    await call("set_compressor", { clip_ids: [v], preset: "voice" });
    await call("set_param", { clip_ids: [v], path: "eq.low", value: 6 });
    await call("set_param", { clip_ids: [v], path: "eq.high", value: -6 });
    const wv = await mix(1, 3);
    await call("split", { clip_ids: [v], at: 2 });
    const sv = await mix(1, 3);
    details.voice = { ...against(wv, sv, 2, 1) };
    details.voice.ok = details.voice.errorUnderSignalDb > 60;
    await mute(t2, true);

    // A compound's own compressor must retain its detector state too.
    const t3 = await track("Compound sound");
    const inner = (await call("add_media_clip", { asset_id: song.id, start: 0, duration: 6, track_id: t3 })).added_clips[0].id;
    const picture = (await call("add_color_clip", { color: "#101010", start: 0, duration: 6 })).added_clips[0].id;
    const compound = (await call("create_compound_clip", { clip_ids: [inner, picture], name: "Compressed scene" })).added_clips[0].id;
    await call("set_compressor", { clip_ids: [compound], preset: "strong" });
    await call("set_param", { clip_ids: [compound], path: "eq.low", value: 6 });
    const wc = await mix(2, 4);
    await call("split", { clip_ids: [compound], at: 3 });
    details.compound = against(wc, await mix(2, 4), 3, 2);
    details.compound.ok = details.compound.errorUnderSignalDb > 60 && details.compound.signalDb > -60;
    return { ok: Object.values(details).every((d) => d.ok), details };
  });
};
