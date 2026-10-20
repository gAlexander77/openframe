// Voice and sound an agent can trust without ears (ADR-104), through MCP:
// a song cut on its bars joins with a crossfade preview_audio's edges call
// clean, and the butt cut it replaced shows its hole; an MP3 song plays
// without a dropout at its render windows; a slow line with a
// pause mark is read no faster than speed 1, its mark out of the pace; a
// band asked on a retake is held exactly; the music track is ducked in one
// call with every line under the ceiling, and dipped again under the
// retake in the same undo step; review's match is under 1 whenever it
// lists a difference; an edit that moves a line says the dip stayed.
async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  page.setDefaultTimeout(900000);
  await page.locator(".create-card").click();
  const call = async (name, args = {}) => {
    const r = await page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
    if (r.result?.isError || r.error) throw new Error(name + ": " + JSON.stringify(r));
    const text = r.result.content.find((c) => c.type === "text").text;
    return JSON.parse(text);
  };
  const { music, track } = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: "music-30s.mp3", src: "http://localhost:1420/fixtures/media/music-30s.mp3" }]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0 });
    const t = ve.describe().tracks.find((t) => t.clips.some((c) => c.type === "audio"));
    return { music: t.clips[0].id, track: t.id };
  });
  await call("set_music_grid", { clip_id: music, bpm: 120, first_downbeat: 0 });
  const cut = await call("cut_music", { clip_id: music, from: 7.9, to: 12.1 });
  const second = cut.added_clips[0].id;
  const joined = await call("preview_audio", { start: 6, end: 10, solo: "music", audio: false });
  // Across its 10 s render windows: an MP3's cold decoder lost a packet at each.
  const whole = await call("preview_audio", { start: 0.5, end: 25.5, solo: "music", audio: false });
  await call("set_crossfade", { clip_id: music, seconds: 0 });
  const butt = await call("preview_audio", { start: 6, end: 10, solo: "music", audio: false });
  await call("undo");
  const vo = await call("add_voiceover", {
    captions: false,
    lines: [
      { text: "Every cut brings your ideas to life.", at: 3 },
      { text: "Northbound. [pause 0.4] Find your north.", at: 14, pace: "slow" },
    ],
  });
  const tagline = vo.lines[1];
  const duck = await call("duck_under_speech", { track_id: track, voice_above_music_lu: 12, min_line_lu: 10 });
  const retake = await call("retake_voiceover", { clip_id: tagline.voice_clip, words_per_second: [1.8, 2.2] });
  const desc = await call("describe_project");
  const keys = desc.tracks.flatMap((t) => t.clips).find((c) => c.id === second).keyframes?.volume ?? [];
  // The dip's last low key sits at or after the new take's end.
  const lows = keys.filter((k) => k[1] < 0.9);
  await call("undo");
  const undone = (await call("describe_project")).tracks.flatMap((t) => t.clips).find((c) => c.id === tagline.voice_clip);
  const review = await call("review_voiceover", {});
  const moved = await call("move_clip", { clip_id: vo.lines[0].voice_clip, start: 2 });
  const each = duck.balance?.per_line?.each ?? [];
  const details = {
    // cut_music: on the bars, the join crossfaded and clean; the butt cut's hole found.
    joined: { ok: /Cut 8-12 s of the song's file, 2 bars at 120 BPM.*0.03 s crossfade/.test(cut.notes?.[0] ?? "") && joined.edges?.length === 1 && joined.edges[0].verdict === "clean", note: cut.notes, edges: joined.edges },
    butt: { ok: butt.edges?.[0]?.dip_db <= -10 && butt.edges[0].fix?.tool === "set_crossfade", edges: butt.edges },
    // No few milliseconds of silence anywhere: not at the windows, not where the second piece starts.
    noDropouts: { ok: whole.dropouts === undefined && whole.edges?.length === 1 && whole.edges[0].verdict === "clean", dropouts: whole.dropouts, edges: whole.edges },
    // The slow line with a pause mark: no faster than its own pace, on its band with the mark out.
    slow: { ok: tagline.speed <= 1 && tagline.target_words_per_second.join() === "1.8,2.3" && tagline.words_per_second >= 1.8 * 0.9, line: tagline },
    // The whole track in one call, every line between 10 and the 15 LU ceiling.
    track: { ok: duck.clips?.length === 2 && duck.balance.met === true && duck.balance.per_line.max_target_lu === 15 && each.every((l) => l.voice_above_music_lu >= 9.95 && (l.voice_above_music_lu <= 15.05 || l.depth_db === 0)), clips: duck.clips, each },
    // A band asked wins over the slow pace kept with the line; the music dipped again under it, one undo for both.
    retake: { ok: retake.target_words_per_second.join() === "1.8,2.2" && retake.ducking?.[0]?.dipped_again === true && lows.length > 0 && Math.max(...lows.map((k) => k[0])) >= retake.end - 0.05 && Math.abs(undone.end - tagline.end) < 0.04, retake, lows, undone: undone.end },
    // Never match 1 beside a difference.
    match: { ok: review.lines.every((l) => (l.differences.length ? l.match < 1 : true)), lines: review.lines.map((l) => [l.heard, l.match, l.differences]) },
    // Moving a line under the ducked music says the dip stayed where it was.
    stale: { ok: (moved.notes ?? []).some((n) => /still dips for the voice as it was before this edit.*duck_under_speech/.test(n)), notes: moved.notes },
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
