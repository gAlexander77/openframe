// A compressor and an EQ on a compound clip (ADR-100), through
// window.videoEditor.mcp as an agent calls it: set_compressor takes the
// compound clip, its mix is evened out as one bus (the loud and quiet
// seconds closer, the peaks down), its EQ is heard, its fade-out still
// fades after the compressor, and export's 10 s windows join without a
// jump in the compressor's level. preview_audio's mix names the picture's
// own sound beside the stems. A compressor, a clip's or a bus's, runs on
// across export's windows as if rendered in one go.
async (page) => {
  page.setDefaultTimeout(120000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  return page.evaluate(async () => {
    const ve = window.videoEditor;
    const raw = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? r.result.content[0].text}`);
      return r.result.content;
    };
    const call = async (name, args) => JSON.parse((await raw(name, args)).at(-1).text);
    const details = {};
    const [video, speech, song] = await ve.import(["h264-1080p30.mp4", "speech-test.wav", "music-stereo.m4a"].map((n) => ({ name: n, src: `${location.origin}/fixtures/media/${n}` })));
    // Two 10 s shots with their own sound, a voice over a song, all nested.
    const shot = (await call("add_media_clip", { asset_id: video.id, start: 0 })).added_clips[0].id;
    const shot2 = (await call("add_media_clip", { asset_id: video.id, start: 10 })).added_clips[0].id;
    const vo = (await call("add_track", { kind: "audio", name: "Voiceover", role: "dialog" })).added_tracks[0].id;
    const mu = (await call("add_track", { kind: "audio", name: "Music", role: "music" })).added_tracks[0].id;
    const line = (await call("add_media_clip", { asset_id: speech.id, start: 2, track_id: vo })).added_clips[0].id;
    const line2 = (await call("add_media_clip", { asset_id: speech.id, start: 11, track_id: vo })).added_clips[0].id;
    const bed = (await call("add_media_clip", { asset_id: song.id, start: 0, duration: 12, track_id: mu })).added_clips[0].id;
    const bed2 = (await call("add_media_clip", { asset_id: song.id, start: 12, in: 2, duration: 8, track_id: mu })).added_clips[0].id;
    await call("set_param", { clip_ids: [bed, bed2], path: "volume", value: 0.35 });

    // Export renders 10 s windows: a compressor must not start cold at
    // each (its empty 6 ms lookahead cut a gap into the sound, its gain
    // stepped). The 20 ms after the join against one render of it all.
    const { renderMixWindow, mixPreroll } = await import("/src/engine/mixdown.ts");
    const windowJump = async () => {
      const p = ve.project();
      const rate = 48000, pre = mixPreroll(p), at = 10 * rate, w = Math.round(0.02 * rate);
      const b = (await renderMixWindow(p, 10, rate, rate, 2, pre)).getChannelData(0);
      const whole = (await renderMixWindow(p, 0, 11 * rate, rate, 2, 0)).getChannelData(0);
      const level = (x, from, to) => {
        let e = 0;
        for (let i = from; i < to; i++) e += x[i] * x[i];
        return 10 * Math.log10(e / (to - from) + 1e-12);
      };
      return { jumpDb: +(level(b, 0, w) - level(whole, at, at + w)).toFixed(2), preroll: pre };
    };
    await call("set_compressor", { clip_ids: [bed], preset: "voice" });
    const clipJoin = await windowJump();
    details.clipWindows = { ok: Math.abs(clipJoin.jumpDb) < 0.5, ...clipJoin };

    // The picture's own sound is a stem of its own in the mix's answer.
    const mixed = await call("preview_audio", { start: 0, end: 10, audio: false });
    details.pictureStem = { ok: typeof mixed.stems.picture === "number" && typeof mixed.stems.dialog === "number", stems: mixed.stems };

    await call("set_param", { clip_ids: [shot, shot2], path: "volume", value: 0 });
    await call("create_compound_clip", { clip_ids: [shot, shot2, line, line2, bed, bed2], name: "Scene" });
    const comp = ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.type === "compound").id;
    const hear = (a, b) => call("preview_audio", { start: a, end: b, audio: false });
    const spread = (r) => {
      const s = r.per_second_lufs.filter((x) => x !== null);
      return +(Math.max(...s) - Math.min(...s)).toFixed(1);
    };
    const plain = await hear(0, 10);
    // set_compressor took video and audio clips only.
    await call("set_compressor", { clip_ids: [comp], preset: "strong" });
    const strong = await hear(0, 10);
    details.compressed = {
      ok: ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.id === comp).compressor === "strong" && spread(strong) < spread(plain) - 2 && strong.true_peak_dbtp < plain.true_peak_dbtp - 3,
      spread: [spread(plain), spread(strong)], truePeak: [plain.true_peak_dbtp, strong.true_peak_dbtp], lufs: [plain.integrated_lufs, strong.integrated_lufs],
    };
    // Its EQ is heard (it was stored and ignored).
    await call("set_param", { clip_ids: [comp], path: "eq.low", value: -12 });
    const eq = await hear(0, 10);
    details.eq = { ok: eq.spectrum.low < strong.spectrum.low - 0.04, low: [strong.spectrum.low, eq.spectrum.low] };
    // Its fade-out comes after the compressor, which does not undo it.
    await call("set_fades", { clip_ids: [comp], fade_out: 3 });
    const faded = await hear(10, 20);
    details.fade = { ok: faded.per_second_lufs[9] < faded.per_second_lufs[5] - 12, seconds: faded.per_second_lufs };

    // The bus compressor joins the windows as the clip's does.
    const busJoin = await windowJump();
    details.busWindows = { ok: Math.abs(busJoin.jumpDb) < 0.5, ...busJoin };
    return { ok: Object.values(details).every((d) => d.ok), details };
  });
};
