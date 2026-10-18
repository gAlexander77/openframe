// An epic edit, made the way an agent makes one: only MCP tool calls
// (window.videoEditor.mcp, JSON-RPC tools/call), from a new project to a
// contact sheet. A 13 s montage on beat-128.m4a (128 BPM from 0.25 s): the
// music read with analyze_music, fifteen shots cut to its beats speeding
// up from four beats a shot to one, flash and zoom hits on every bar from
// the first cut, shake and RGB split on the fast cuts, a whip pan and a
// zoom punch, a speed ramp whose slow moment lands on a beat, 2.39:1 bars
// sliding in, two animated titles, a riser into the first cut with an
// impact on it, punch-ins on the portrait footage, and the music ended
// on the last bar with a fade.
//
// Checks: every cut within a frame of a true beat, the hits and bars in
// place, the music ending with the picture, every sheet tile lit. Saves
// the sheet to scratch/epic-edit-sheet.png for a look by eye.
async (page) => {
  page.setDefaultTimeout(20000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  let id = 0;
  const call = (name, args = {}) =>
    page.evaluate(async ([name, args, id]) => {
      const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
      const c = r.result?.content?.[0];
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? c.text}`);
      return c.type === "text" ? JSON.parse(c.text) : c;
    }, [name, args, ++id]);
  const details = {};
  const BEAT = 60 / 128;
  const beat = (k) => 0.25 + k * BEAT;
  const offBeat = (t) => Math.abs(t - beat(Math.round((t - 0.25) / BEAT)));

  await call("new_project", { name: "Epic edit" });
  await page.locator(".timeline-panel").waitFor();
  await call("set_project", { width: 1920, height: 1080, fps: "30" });
  const origin = new URL(page.url()).origin;
  const names = ["beat-128.m4a", "person-pan.mp4", "scene-cuts.mp4", "shaky.mp4", "photo.jpg"];
  const assets = await call("import_media", { files: names.map((n) => ({ src: `${origin}/fixtures/media/${n}`, name: n })) });
  const [song, person, scenes, shaky, photo] = names.map((n) => assets.find((a) => a.name === n).id);

  // The music and its beat grid.
  const music = (await call("add_media_clip", { asset_id: song, start: 0 })).added_clips[0];
  const grid = await call("analyze_music", { clip_id: music.id, markers: ["beats", "bars"] });
  details.music = { ok: Math.abs(grid.bpm - 128) < 0.5 && grid.downbeats.length >= 8, bpm: grid.bpm, downbeats: grid.downbeats.slice(0, 4), sections: grid.sections.map((s) => s.label) };

  // Fifteen shots: a four-beat opener, four of two beats, eight of one, two of four.
  const shot = (asset_id, beats, at) => ({ asset_id, beats, ...(at !== undefined ? { in: at } : {}) });
  const cut = await call("cut_to_beats", {
    media: [
      shot(person, 4, 0), shot(scenes, 2, 0.2), shot(shaky, 2, 0), shot(person, 2, 2.5), shot(scenes, 2, 0.9),
      shot(person, 1, 3.4), shot(scenes, 1, 3.0), shot(person, 1, 1.5), shot(shaky, 1, 1.5), shot(scenes, 1, 1.6), shot(person, 1, 4.2), shot(photo, 1), shot(scenes, 1, 4.2),
      shot(shaky, 4, 0.5), shot(person, 4, 1),
    ],
  });
  const shots = cut.added_clips.filter((c) => c.type !== "audio").sort((a, b) => a.start - b.start);
  // Punch-ins on the portrait footage: the same take, three framings.
  await call("frame_region", { clip_id: shots[3].id, region: { x: 0.2, y: 0, w: 0.6, h: 0.8 }, to_region: { x: 0.3, y: 0.05, w: 0.4, h: 0.55 } });
  await call("frame_region", { clip_id: shots[5].id, region: { x: 0.33, y: 0.12, w: 0.34, h: 0.3 } });
  await call("frame_region", { clip_id: shots[10].id, region: { x: 0.25, y: 0.45, w: 0.5, h: 0.55 } });
  const cuts = shots.slice(1).map((c) => c.start);
  details.cuts = { ok: shots.length === 15 && cuts.every((t) => offBeat(t) <= 1 / 30 + 1e-3), cuts, worst: Math.max(...cuts.map(offBeat)) };
  const fast = shots[5].start, hero = shots[14];

  // Hits, moves and the ramp.
  const barHits = await call("add_beat_hits", { effects: ["flash", "zoom"], marker_label: "Bar", from: 2, intensity: 0.7 });
  const cutHits = await call("add_beat_hits", { effects: ["shake", "rgb_split"], at_cuts: true, from: fast - 0.01, to: shots[13].start, intensity: 0.6 });
  await call("set_transition", { clip_id: shots[4].id, type: "whipLeft", duration: 0.3 });
  await call("set_transition", { clip_id: shots[13].id, type: "zoomPunch", duration: 0.3 });
  const ramp = await call("set_speed_ramp", { clip_id: hero.id });
  const ramped = ramp.changed_clips.find((c) => c.id === hero.id);
  details.ramp = { ok: ramped.speed_curve === "custom" && ramped.start === hero.start && ramped.end === hero.end, clip: [ramped.start, ramped.end, ramped.in, ramped.out] };

  // Bars, titles and sound.
  await call("add_cinematic_bars", { ratio: 2.39, animate_in: 0.6 });
  const titleStyle = { size: 190, bold: true, color: "#ffffff", case: "upper", stroke: { color: "#000000", width: 6 }, shadow: { color: "rgba(0,0,0,0.7)", blur: 24, y: 6 } };
  const t1 = (await call("add_text", { text: "Epic edit", start: 0.3, duration: 1.75, y: 0.24, style: titleStyle })).added_clips[0];
  await call("set_animation", { clip_id: t1.id, slot: "in", type: "zoomOut", duration: 0.4 });
  await call("set_animation", { clip_id: t1.id, slot: "out", type: "fade", duration: 0.25 });
  const t2 = (await call("add_text", { text: "Cut to the beat", start: hero.start + 0.1, duration: hero.end - hero.start - 0.2, y: 0.28, style: { ...titleStyle, size: 96 } })).added_clips[0];
  await call("set_animation", { clip_id: t2.id, slot: "in", type: "pop", duration: 0.35 });
  await call("add_sound_effect", { name: "rise", end_at: shots[1].start });
  await call("add_sound_effect", { name: "impact", start: shots[1].start });
  await call("add_sound_effect", { name: "swooshUp", end_at: fast });
  await call("add_sound_effect", { name: "subDrop", start: hero.start });
  const fit = await call("fit_music", { clip_id: music.id, end: "bar", fade_out: 1.2, trim_picture: true });
  const desc = await call("describe_project");
  const m = desc.tracks.flatMap((t) => t.clips).find((c) => c.id === music.id);
  const picture = Math.max(...desc.tracks.filter((t) => t.kind === "video").flatMap((t) => t.clips.filter((c) => c.type !== "adjustment").map((c) => c.end)));
  details.fitted = { ok: Math.abs(m.end - picture) < 1e-3 && Math.abs(m.end - hero.end) < 1e-3 && desc.duration >= 12 && desc.duration <= 15 && !!fit.changed_clips, musicEnd: m.end, duration: desc.duration };
  const hits = desc.tracks.filter((t) => t.name.startsWith("Hits")).flatMap((t) => t.clips);
  details.hits = { ok: hits.length >= 10 && (barHits.added_clips ?? []).length >= 5 && (cutHits.added_clips ?? []).length >= 6 && desc.tracks.some((t) => t.name === "Bars" && t.clips.length === 1), hits: hits.length, tracks: desc.tracks.map((t) => t.name) };

  // Look at it: one contact sheet, every tile lit.
  const times = [0.6, 1.5, 2.15, 2.6, 3.4, 4.05, 5.0, 5.9, 6.4, 7.1, 7.75, 8.5, 9.4, 10.3, 12.0, 13.0];
  const sheet = await call("preview_frames", { times, tile_width: 320, columns: 4 });
  const fs = await import("node:fs");
  fs.writeFileSync("__REPO__/scratch/epic-edit-sheet.png", Buffer.from(sheet.data, "base64"));
  const tiles = await page.evaluate(async ([data, n]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const w = 320, h = 180, gap = 6;
    return Array.from({ length: n }, (_, i) => {
      const d = x.getImageData(gap + (i % 4) * (w + gap), gap + Math.floor(i / 4) * (h + gap), w, h).data;
      let s = 0;
      for (let k = 0; k < d.length; k += 4) s += (d[k] + d[k + 1] + d[k + 2]) / 3;
      return Math.round(s / (d.length / 4));
    });
  }, [sheet.data, times.length]);
  details.frames = { ok: tiles.every((v) => v > 15), tiles };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
