// duck_under_speech with a voice-over-music target on speech with long gaps
// (fixtures speech-gaps.m4a over music-30s.mp3). The target is measured
// only while someone speaks, so every stretch of speech sits near the
// target instead of being over-ducked by the loud bed between lines.
async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  const call = async (name, args = {}) => {
    const r = await page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
    if (r.result?.isError || r.error) throw new Error(name + ": " + JSON.stringify(r));
    return JSON.parse(r.result.content[0].text);
  };
  const music = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [m] = await ve.import([{ name: "music-30s.mp3", src: "http://localhost:1420/fixtures/media/music-30s.mp3" }]);
    ve.exec("add_media_clip", { asset_id: m.id, start: 0 });
    const [v] = await ve.import([{ name: "speech-gaps.m4a", src: "http://localhost:1420/fixtures/media/speech-gaps.m4a" }]);
    ve.exec("add_track", { kind: "audio", name: "Voiceover" });
    const track = ve.project().tracks.find((t) => t.name === "Voiceover");
    ve.exec("add_media_clip", { asset_id: v.id, track_id: track.id, start: 1 });
    return ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.type === "audio" && c.name === "music-30s.mp3")?.id
      ?? ve.project().tracks.flatMap((t) => t.clips).find((c) => c.assetId === m.id).id;
  });
  const duck = await call("duck_under_speech", { clip_id: music, voice_above_music_lu: 10 });
  // The dips, read back from the music's volume keys: stretches at the
  // lowest value are where the speech is.
  const keys = await page.evaluate((id) => {
    const c = window.videoEditor.project().tracks.flatMap((t) => t.clips).find((x) => x.id === id);
    const fps = window.videoEditor.project().fps;
    const f = fps.num / fps.den;
    return (c.keyframes?.volume ?? []).map((k) => [(c.start + k.f) / f, k.v]);
  }, music);
  const low = Math.min(...keys.map((k) => k[1]));
  const dips = [];
  for (let i = 0; i + 1 < keys.length; i++) if (keys[i][1] === low && keys[i + 1][1] === low && keys[i + 1][0] - keys[i][0] > 0.6) dips.push([keys[i][0], keys[i + 1][0]]);
  const perDip = [];
  for (const [a, b] of dips) {
    const m = await call("measure_loudness", { start: a, end: b, by_track: true });
    // The dip's own stretch, measured whole (the program window).
    perDip.push({ start: +a.toFixed(2), end: +b.toFixed(2), voice_above_music_lu: m.balance?.program?.voice_above_music_lu });
  }
  const details = {
    target: { ok: duck.balance?.met === true && duck.depth_db < 30, duck },
    dips: { ok: dips.length >= 2, count: dips.length },
    // Each stretch of speech near the target: before the fix they sat
    // 25-40 LU over the music.
    perLine: { ok: perDip.length >= 2 && perDip.every((d) => Number.isFinite(d.voice_above_music_lu) && d.voice_above_music_lu > 6 && d.voice_above_music_lu < 16), perDip },
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
