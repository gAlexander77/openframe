// Sound joins and ducks that hold through later edits (ADR-107), through
// window.videoEditor.mcp as an agent calls it: a split of one sound plays
// on with no hole; cut_music stops before the bar line and starts the
// piece after before its downbeat; an interview kept in a compound clip
// ducks the music; cutting bars out of ducked music says its dips moved;
// a ceiling under the speech target is refused; and the lines together
// stay on the speech target while an infeasible per-line ceiling is
// reported honestly over a quiet passage (ADR-139).
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
    const clips = () => ve.describe().tracks.flatMap((t) => t.clips);
    const added = (r, what = "added_clips") => {
      if (!r[what]?.[0]) throw new Error(`no ${what}: ${JSON.stringify(r)}`);
      return r[what][0].id;
    };
    const [song, beat, talk] = await ve.import(["music-30s.mp3", "beat-128.m4a", "talk-gaps.mp4"].map((n) => ({ name: n, src: `${location.origin}/fixtures/media/${n}` })));
    const details = {};

    // Each case on its own music track, muted when done.
    const track = async (name) => added(await call("add_track", { kind: "audio", name, role: "music" }), "added_tracks");
    // A split of a song: no 4 ms click guard either side, so no hole.
    const t1 = await track("Split");
    const whole = added(await call("add_media_clip", { asset_id: song.id, start: 0, duration: 12, track_id: t1 }));
    await call("split", { clip_ids: [whole], at: 5 });
    const split = await call("preview_audio", { start: 3, end: 7, solo: "music", audio: false });
    const e = split.edges?.[0];
    details.split = { ok: e?.kind === "join" && e.dip_db > -3 && e.verdict === "clean", edge: e };
    await call("update_track", { track_id: t1, muted: true });

    // cut_music on a bar that falls between frames (128 BPM from 0.25 s:
    // 7.75 s is frame 232.5): the first piece stops before the bar line,
    // the second starts before its downbeat, the join measures clean.
    const t2 = await track("Bars");
    const kicks = added(await call("add_media_clip", { asset_id: beat.id, start: 0, track_id: t2 }));
    await call("set_music_grid", { clip_id: kicks, bpm: 128, first_downbeat: 0.25 });
    const cut = await call("cut_music", { clip_id: kicks, from: 7.75, to: 9.625 });
    const [a, b] = clips().filter((c) => c.asset === beat.id);
    const join = await call("preview_audio", { start: a.end - 2, end: a.end + 2, solo: "music", audio: false });
    details.bars = { ok: a.out <= 7.75 && b.in <= 9.625 && Math.abs(b.in - a.out - 1.875) < 0.002 && join.edges?.[0]?.verdict === "clean" && /1 bar at 128 BPM/.test(cut.notes?.[0]), a: [a.end, a.out], b: [b.start, b.in], notes: cut.notes, edges: join.edges };
    await call("update_track", { track_id: t2, muted: true });

    // An interview kept in a compound clip, under a song in two pieces:
    // its speech ducks the music (it said nothing played under it).
    const interview = added(await call("add_media_clip", { asset_id: talk.id, start: 1 }));
    const k = added(await call("create_compound_clip", { clip_ids: [interview], name: "Interview" }));
    const mu = await track("Music");
    const p1 = added(await call("add_media_clip", { asset_id: song.id, start: 0, duration: 4, track_id: mu }));
    const p2 = added(await call("add_media_clip", { asset_id: song.id, start: 4, in: 4, duration: 10, track_id: mu }));
    await call("set_param", { clip_ids: [p1], path: "volume", value: 0.08 });
    const plain = await call("duck_under_speech", { track_id: mu });
    details.compound = { ok: plain.voices === 1 && plain.dips > 0, plain, compound: k };

    // A ceiling under the target is refused before anything is rendered.
    const both = await call("duck_under_speech", { track_id: mu, voice_above_music_lu: 12, max_line_lu: 8 });
    details.contradiction = { ok: /max_line_lu \(8\) is under voice_above_music_lu \(12\)/.test(both.error ?? ""), both };

    // The quiet first piece exceeds the 15 LU ceiling even at zero dip.
    // Speech can meet 12 LU while the combined verdict fails the ceiling;
    // the answer must say why instead of claiming every target was met.
    const duck = await call("duck_under_speech", { track_id: mu, voice_above_music_lu: 12, min_line_lu: 10 });
    const each = duck.balance?.per_line?.each ?? [];
    details.target = { ok: duck.balance?.met === false && duck.balance.per_line.met === false && duck.balance.per_line.max_target_lu === 15 && Math.abs(duck.balance.voice_above_music_lu - 12) <= 0.5 && each.length === 4 && each.every((l) => Number.isFinite(l.voice_above_music_lu) && l.voice_above_music_lu !== null && l.voice_above_music_lu >= 9.95 && (l.voice_above_music_lu <= 15.05 || l.depth_db === 0)) && each.some((l) => l.voice_above_music_lu > 15.05 && l.depth_db === 0) && (duck.notes ?? []).some((n) => /per-line ceiling is not met.*base volume/.test(n)), met: duck.balance?.met, speech: duck.balance?.voice_above_music_lu, each: each.map((l) => [l.start, l.voice_above_music_lu, l.depth_db]), notes: duck.notes };

    // Bars cut out of the ducked song: the piece after plays earlier and
    // its dips with it, away from the lines; the answer says so.
    await call("set_music_grid", { clip_id: p2, bpm: 120, first_downbeat: 0 });
    const moved = await call("cut_music", { clip_id: p2, from: 6, to: 8 });
    details.moved = { ok: (moved.notes ?? []).some((n) => /moved, its dips with it.*duck_under_speech \{"track_id"/.test(n)), notes: moved.notes };
    return { ok: Object.values(details).every((d) => d.ok), details };
  });
};
