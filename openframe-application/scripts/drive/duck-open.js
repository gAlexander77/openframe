// Ducking that knows the music and the hand (ADR-114), through
// window.videoEditor.mcp as an agent calls it: a pause shorter than
// min_gap stays down and the answer lists it; open_at "Drop" brings the
// music up on a marked moment in a held pause; a volume key made by hand
// in a pause survives ducking again; and a radio band-pass on a voice
// keeps its loudness with keep_loudness (it is refused in a batch).
async (page) => {
  page.setDefaultTimeout(300000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  return page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) return { error: r.error?.message ?? r.result.content[0].text };
      return JSON.parse(r.result.content.at(-1).text);
    };
    const [song, talk] = await ve.import(["music-30s.mp3", "speech-gaps.m4a"].map((n) => ({ name: n, src: `${location.origin}/fixtures/media/${n}` })));
    const music = (await call("add_track", { kind: "audio", name: "Music", role: "music" })).added_tracks[0].id;
    const vo = (await call("add_track", { kind: "audio", name: "Voiceover", role: "dialog" })).added_tracks[0].id;
    const m = (await call("add_media_clip", { asset_id: song.id, start: 0, track_id: music })).added_clips[0].id;
    const v = (await call("add_media_clip", { asset_id: talk.id, start: 1, track_id: vo })).added_clips[0].id;
    const fps = ve.project().fps;
    const at = (s) => Math.round((s * fps.num) / fps.den);
    const level = (s) => ve.paramAt(m, "volume", at(s));
    const details = {};

    // Every pause held (min_gap 10 s): the answer names them.
    const held = await call("duck_under_speech", { track_id: music, voice_above_music_lu: 12, min_gap: 10 });
    const pause = held.held?.[0];
    details.held = { ok: Array.isArray(held.held) && held.held.length >= 1 && held.dips === 1, held: held.held, dips: held.dips };
    if (!pause) return { ok: false, details };

    // A drop marked in that pause: noted as ducked, then opened when asked.
    const drop = +((pause[0] + pause[1]) / 2).toFixed(2);
    await call("add_marker", { at: drop, label: "Drop" });
    const noted = await call("duck_under_speech", { track_id: music, voice_above_music_lu: 12, min_gap: 10 });
    const opened = await call("duck_under_speech", { track_id: music, voice_above_music_lu: 12, min_gap: 10, open_at: ["Drop"] });
    const low = level(pause[0] - 0.05);
    details.opened = {
      ok: (noted.notes ?? []).some((n) => /Drop at .* play[s]? ducked: open_at \["Drop"\]/.test(n)) && opened.open?.[0]?.label === "Drop" && Array.isArray(opened.open[0].up) && Math.abs(level(drop) - 1) < 1e-6 && low < 0.9 && !(opened.held ?? []).some(([a]) => a === pause[0]) && opened.balance?.met === true,
      notes: noted.notes, open: opened.open, atDrop: level(drop), underLine: low,
    };
    const refused = await call("duck_under_speech", { track_id: music, voice_above_music_lu: 12, open_at: ["Chorus"] });
    details.unknownLabel = { ok: /no marker is labeled so/.test(refused.error ?? ""), error: refused.error };

    // A lift by hand at the drop survives ducking again; one under a line does not.
    const line = (opened.balance?.per_line?.each ?? [])[0];
    await call("set_param", { clip_ids: [m], path: "volume", value: 0.6, at: drop });
    await call("set_param", { clip_ids: [m], path: "volume", value: 0.9, at: +((line.start + line.end) / 2).toFixed(2) });
    const again = await call("duck_under_speech", { track_id: music, voice_above_music_lu: 12, min_gap: 10, open_at: ["Drop"] });
    details.handKeys = { ok: Math.abs(level(drop) - 0.6) < 1e-6 && again.hand_keys?.kept?.length === 1 && again.hand_keys?.replaced?.length === 1 && level((line.start + line.end) / 2) < 0.9, hand: again.hand_keys, atDrop: level(drop) };

    // A radio band-pass on the voice: quieter by itself, as loud with keep_loudness.
    const voice = async () => (await call("preview_audio", { start: 1, end: 13, solo: "voice", audio: false })).integrated_lufs;
    const before = await voice();
    const batched = await call("batch", { commands: [{ command: "set_audio_filter", args: { clip_ids: [v], type: "highpass", cutoff: 380, resonance: 3 } }, { command: "set_audio_filter", args: { clip_ids: [v], type: "lowpass", cutoff: 3400, resonance: 3 } }] });
    const thin = await voice();
    await call("undo");
    await call("set_audio_filter", { clip_ids: [v], type: "highpass", cutoff: 380, resonance: 3, keep_loudness: true });
    const kept = await call("set_audio_filter", { clip_ids: [v], type: "lowpass", cutoff: 3400, resonance: 3, keep_loudness: true });
    const after = await voice();
    const inBatch = await call("batch", { commands: [{ command: "set_audio_filter", args: { clip_ids: [v], type: "highpass", cutoff: 400, keep_loudness: true } }] });
    const c = ve.project().tracks.flatMap((t) => t.clips).find((x) => x.id === v);
    details.keepLoudness = {
      ok: before - thin > 1 && Math.abs(after - before) <= 0.5 && c.highpass?.makeup > 0 && (batched.notes ?? []).filter((n) => /keep_loudness: true/.test(n)).length === 1 && /not in a batch/.test(inBatch.error ?? ""),
      before, thin, after, makeup: [c.highpass?.makeup, c.lowpass?.makeup], notes: kept.notes,
    };
    return { ok: Object.values(details).every((d) => d.ok), details };
  });
};
