// Cut to the beat: analyze_music reads beat-128.m4a (a drum loop at
// exactly 128 BPM from 0.25 s) as data and markers, then cut_to_beats
// lays four media files end to end so every cut lands on a beat, then on
// bars. All through window.videoEditor.mcp, as an agent would; each edit
// is one undo step, and the viewer shows the shots.
async (page) => {
  page.setDefaultTimeout(15000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const call = (name, args = {}) =>
    page.evaluate(async ([name, args]) => {
      const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      const c = r.result?.content?.[0];
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? c.text}`);
      return c.type === "text" ? JSON.parse(c.text) : c;
    }, [name, args]);
  const origin = new URL(page.url()).origin;
  const files = ["beat-128.m4a", "scene-cuts.mp4", "person-pan.mp4", "photo.jpg", "shaky.mp4"];
  const assets = await call("import_media", { files: files.map((n) => ({ src: `${origin}/fixtures/media/${n}`, name: n })) });
  const id = (n) => assets.find((a) => a.name === n).id;
  const details = {};
  const BEAT = 60 / 128;
  const offBeat = (t) => Math.abs(t - (0.25 + BEAT * Math.round((t - 0.25) / BEAT)));

  const music = (await call("add_media_clip", { asset_id: id("beat-128.m4a"), start: 0 })).added_clips[0];
  const m = await call("analyze_music", { clip_id: music.id, markers: ["beats", "bars"], detail: "full" });
  details.analysis = {
    ok: Math.abs(m.bpm - 128) < 0.5 && m.beats.length >= 40 && m.beats.every((t) => offBeat(t) < 1 / 30) && m.downbeats.length >= 10 && m.downbeats.every((t, i) => i === 0 || Math.abs(t - m.downbeats[i - 1] - 4 * BEAT) < 0.04) && m.beat_energy.length === m.beats.length && m.sections.length >= 1 && m.markers > 0,
    bpm: m.bpm,
    beats: m.beats.length,
    first: m.beats.slice(0, 3),
    downbeats: m.downbeats.slice(0, 3),
    sections: m.sections,
    drop: m.drop,
    hits: m.hits.length,
    markers: m.markers,
  };
  const desc = await call("describe_project");
  const bars = desc.markers.filter((x) => x.label === "Bar");
  details.markers = { ok: desc.markers.filter((x) => x.label === "Beat").length === m.beats.length && bars.length === m.downbeats.length, beats: desc.markers.filter((x) => x.label === "Beat").length, bars: bars.length };

  const media = [id("scene-cuts.mp4"), id("person-pan.mp4"), id("photo.jpg"), id("scene-cuts.mp4"), id("shaky.mp4"), id("person-pan.mp4"), id("scene-cuts.mp4"), id("photo.jpg")].map((a) => ({ asset_id: a }));
  const cut = await call("cut_to_beats", { media, pattern: [4, 2, 2, 1, 1] });
  const shots = cut.added_clips.filter((c) => c.type === "video" || c.type === "image").sort((a, b) => a.start - b.start);
  const starts = shots.map((c) => c.start);
  details.cuts = {
    ok: shots.length === 8 && starts[0] === 0 && starts.slice(1).every((t) => offBeat(t) <= 1 / 30 + 1e-3) && shots.every((c, i) => i === 0 || Math.abs(c.start - shots[i - 1].end) < 1e-6) && shots.filter((c) => c.type === "video").every((c) => c.end - c.start > 0.4),
    starts,
    worstOffBeat: Math.max(...starts.slice(1).map(offBeat)),
    // Steps of 4, 2, 2, 1, 1 beats after the 0.25 s pickup.
    lengths: shots.map((c) => +(c.end - c.start).toFixed(3)),
  };
  // The second scene-cuts shot carries on where the first ended.
  const sc = shots.filter((c) => c.asset === id("scene-cuts.mp4"));
  details.carriesOn = { ok: Math.abs(sc[1].in - sc[0].out) < 0.04, first: [sc[0].in, sc[0].out], second: sc[1].in };
  details.oneUndo = { ok: (await call("undo")).removed_clips?.length === 8 };
  await call("redo");

  // On bars instead: every cut on a downbeat.
  await call("undo");
  const onBars = await call("cut_to_beats", { media: media.slice(0, 4), grid: "bars" });
  const bs = onBars.added_clips.sort((a, b) => a.start - b.start).map((c) => c.start);
  details.bars = { ok: bs.length === 4 && bs.slice(1).every((t) => m.downbeats.some((d) => Math.abs(d - t) < 1 / 30 + 1e-3)), starts: bs };

  // The viewer shows a shot, not black.
  const sheet = await call("preview_frames", { times: [0.5, bs[1] + 0.2, bs[2] + 0.2, bs[3] + 0.2], tile_width: 240 });
  await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    window.__sheet = img;
  }, sheet.data);
  const lit = await page.evaluate(() => {
    const img = window.__sheet;
    const c = new OffscreenCanvas(img.width, img.height);
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s / (d.length / 4) / 3;
  });
  details.picture = { ok: lit > 30, meanLevel: Math.round(lit) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
