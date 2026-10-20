// Structure on edited work (ADR-101), as an agent meets it through
// window.videoEditor.mcp:
// - open_project of the project open now, edited and never saved, opens it;
// - a unique copy of a card that nests a window owns its window: other
//   footage in the copy leaves the original's;
// - a song's markers stay on its beats through a trim, a move and a speed
//   change, a second reading replaces them, mark_beats answers timeline
//   seconds and the tempo heard;
// - set_music_grid keeps the song's grid, places its markers and is what
//   check_project judges the cuts by;
// - export_versions overrides hide and move clips in one version, kept in
//   the saved version project.
async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  const rpc = (method, params = {}) => page.evaluate(([method, params]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method, params }), [method, params]);
  const call = async (name, args = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    if (r.error) throw new Error(`${name}: ${r.error.message}`);
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    return JSON.parse(r.result.content[0].text);
  };
  const tryCall = (name, args) => call(name, args).then((v) => ({ v }), (e) => ({ error: e.message }));
  const origin = await page.evaluate(() => location.origin);
  const details = {};

  // ---- open_project of the open, never-saved project ----
  await call("new_project", { name: "Edited structure" });
  const [song, shot] = await call("import_media", { files: [{ src: `${origin}/fixtures/media/beat-128.m4a` }, { src: `${origin}/fixtures/media/person-pan.mp4` }] });
  await call("add_media_clip", { asset_id: shot.id, start: 0, duration: 4 });
  const opened = await tryCall("open_project", { project: "Edited structure" });
  details.reopenOpen = { ok: !opened.error && opened.v.duration === 4, ...opened };

  // ---- a unique copy owns the window nested in it ----
  const made = await call("batch", { commands: [
    { command: "add_track", args: { kind: "video", name: "Window" } },
    { command: "add_media_clip", args: { asset_id: shot.id, start: 0, duration: 4, track_id: "$1.track" } },
    { command: "set_param", args: { clip_ids: ["$2"], path: "transform.scale", value: 0.4 } },
    { command: "add_shape", args: { kind: "rounded_rectangle", start: 0, duration: 4, width: 0.4, height: 0.4, fill: false, stroke_width: 4 } },
    { command: "create_compound_clip", args: { clip_ids: ["$2", "$4"], name: "Window" } },
    { command: "add_text", args: { text: "HARBOR", start: 0, duration: 4, y: 0.3 } },
    { command: "create_compound_clip", args: { clip_ids: ["$5", "$6"], name: "Card" } },
  ] });
  const card = made.added_clips.find((c) => c.type === "compound");
  const copy = await call("duplicate_clips", { clip_ids: [card.id], at: 4, unique: true });
  const d = await call("describe_project");
  const k = (id) => d.compounds.find((x) => x.id === id);
  const nested = (id) => k(id).tracks.flatMap((t) => t.clips).find((c) => c.type === "compound").compound;
  const copyCard = copy.added_compounds.find((x) => x.name.startsWith("Card")).id;
  const footage = k(nested(copyCard)).tracks.flatMap((t) => t.clips).find((c) => c.type === "video");
  await call("import_media", { files: [{ src: `${origin}/fixtures/media/photo.jpg` }] }).then(async ([photo]) => call("edit_compound", { compound_id: nested(copyCard), command: "replace_clip", args: { clip_id: footage.id, asset_id: photo.id } }));
  const after = await call("describe_project");
  const assetIn = (id) => after.compounds.find((x) => x.id === id).tracks.flatMap((t) => t.clips).find((c) => c.type !== "color")?.asset;
  details.uniqueNested = { ok: nested(copyCard) !== nested(card.compound) && assetIn(nested(card.compound)) === shot.id && assetIn(nested(copyCard)) !== shot.id, copied: copy.added_compounds.map((x) => x.name) };

  // ---- a song's markers follow its clip ----
  await call("new_project", { name: "Edited song" });
  const [beat] = await call("import_media", { files: [{ src: `${origin}/fixtures/media/beat-128.m4a` }] });
  const track = (await call("add_track", { kind: "audio", name: "Music", role: "music" })).added_tracks[0].id;
  const music = (await call("add_media_clip", { asset_id: beat.id, start: 0, track_id: track })).added_clips[0];
  await call("analyze_music", { clip_id: music.id, markers: ["beats", "bars"] });
  // The loop's beats: every 60/128 s from 0.25 s of the file.
  const worst = async () => {
    const p = await call("describe_project");
    const c = p.tracks.flatMap((t) => t.clips).find((x) => x.id === music.id);
    const beats = p.markers.filter((m) => m.label === "Beat");
    const off = beats.map((m) => {
      const s = c.in + (m.at - c.start) * (c.speed ?? 1);
      const k = (s - 0.25) / (60 / 128);
      return (Math.abs(k - Math.round(k)) * (60 / 128)) / (c.speed ?? 1);
    });
    return { count: beats.length, worstMs: Math.round(Math.max(...off) * 1000), bars: p.markers.filter((m) => m.label === "Bar").length };
  };
  const edits = {};
  edits.read = await worst();
  await call("trim_clip", { clip_id: music.id, edge: "start", to: 1.3 });
  edits.trimmed = await worst();
  await call("move_clip", { clip_id: music.id, start: 2 });
  edits.moved = await worst();
  await call("set_speed", { clip_id: music.id, speed: 1.25 });
  edits.sped = await worst();
  const again = await call("analyze_music", { clip_id: music.id, markers: ["beats", "bars"] });
  edits.again = await worst();
  const marked = await call("mark_beats", { clip_id: music.id });
  details.markersFollow = {
    ok: Object.values(edits).every((e) => e.count > 10 && e.worstMs <= 34) && edits.again.count === edits.sped.count && again.markers === 0 && Math.abs(again.bpm - 160) < 2 && again.file_bpm > 126 && Math.abs(marked.bpm - 160) < 2 && marked.markers === 0 && marked.beats[0] >= 2,
    edits,
    bpm: [again.bpm, again.file_bpm, marked.bpm],
  };

  // ---- a song's grid, given ----
  const grid = await call("set_music_grid", { clip_id: music.id, bpm: 128, first_downbeat: 0.25, sections: [{ at: 0, label: "intro" }, { at: 4, label: "drop" }], markers: ["beats", "bars", "drop"] });
  const withGrid = await worst();
  const kept = (await call("describe_project")).assets.find((a) => a.id === beat.id).music_grid;
  // Cuts on the given grid pass check_project; with no markers at all, the grid is still the grid.
  await call("delete_markers", { marker_ids: (await call("describe_project")).markers.map((m) => m.id) });
  const bar = 4 * (60 / 128) / 1.25;
  const first = 2 + ((0.25 + 3 * (60 / 128)) - 1.3) / 1.25; // the first beat after the in-point
  await call("add_media_clip", { asset_id: (await call("import_media", { files: [{ src: `${origin}/fixtures/media/person-pan.mp4` }] }))[0].id, start: 0, duration: first + 2 * bar });
  const main = (await call("describe_project")).tracks.find((t) => t.main).clips[0];
  await call("split_at_times", { clip_id: main.id, times: [first, first + bar] });
  const check = await call("check_project", { kind: "epic_edit" });
  details.givenGrid = {
    ok: /160 BPM as it plays/.test(grid.notes?.[0] ?? "") && withGrid.worstMs <= 20 && kept?.bpm === 128 && !check.findings.some((f) => f.rule === "no_beat_grid" || f.rule === "cuts_off_beat"),
    note: grid.notes?.[0],
    withGrid,
    findings: check.findings.map((f) => f.rule),
  };

  // ---- a version's overrides, kept in its saved project ----
  await call("set_project", { width: 1920, height: 1080 });
  const t = (await call("add_text", { text: "Lower", start: 0, duration: 2, x: -0.3, y: 0.35 })).added_clips[0];
  const saved = await call("export_versions", { versions: [{ ratio: "9:16", name: "Edited song tall", overrides: [{ clip_id: t.id, y: 0.1 }, { clip_id: main.id, hidden: true }] }], save_projects: true });
  await call("open_project", { project: saved.projects[0].id });
  const v = (await call("describe_project")).tracks.flatMap((tr) => tr.clips);
  const unknown = await tryCall("export_versions", { versions: [{ ratio: "1:1", overrides: [{ clip_id: "c_none", hidden: true }] }], check: true });
  details.overrides = {
    ok: v.find((c) => c.id === t.id)?.transform?.y === 0.1 && v.find((c) => c.id === main.id)?.disabled === true && /no clip c_none/.test(unknown.error ?? ""),
    unknown: unknown.error,
  };
  return { ok: Object.values(details).every((x) => x.ok), details };
};
