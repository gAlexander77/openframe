// Multicam, punch-ins on jump cuts and the slideshow, called over MCP as an
// agent calls them (ADR-148) and checked on what the engine draws:
// - sync_audio lines a second camera (sync-camera-b.mp4, a plain teal
//   picture whose sound starts 1.5 s into the first camera's) up with the
//   first by their sound; switch_angles then shows one angle at a time,
//   and the frames say which.
// - punch_in_cuts: a talking head with two stretches cut out of it; the
//   middle piece is drawn 1.15 times larger, measured on its burned-in
//   words.
// - add_slideshow: pictures that fill the frame, move, and dissolve.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const rpc = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const text = (r) => r.result.content.find((c) => c.type === "text")?.text ?? "";
  /** A tool's answer; a long tool's job is followed to its end (trap 29). */
  const call = async (name, args = {}) => {
    let r = await rpc(name, args);
    if (r.result.isError) throw new Error(`${name}: ${text(r)}`);
    let answer = JSON.parse(text(r));
    for (let i = 0; answer && answer.state === "running" && answer.job_id && i < 100; i++) {
      await page.waitForTimeout(1500);
      const s = JSON.parse(text(await rpc("job_status", { job_id: answer.job_id })));
      if (s.state === "failed") throw new Error(`${name}: ${JSON.stringify(s)}`);
      if (s.state === "done") answer = s.result;
    }
    return answer;
  };
  /** A frame's share of teal pixels, its lit share, and how wide its white letters reach. */
  const look = async (at) => {
    const png = (await rpc("preview_frame", { at, max_width: 640 })).result.content[0].data;
    return page.evaluate(async (png) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      let teal = 0, lit = 0, left = bmp.width, right = -1, sum = 0;
      for (let y = 0; y < bmp.height; y++)
        for (let x = 0; x < bmp.width; x++) {
          const i = (y * bmp.width + x) * 4, r = d[i], gr = d[i + 1], b = d[i + 2];
          if (r < 90 && gr > 120 && b > 105 && gr > b) teal++;
          if (r + gr + b > 60) lit++;
          if (r > 200 && gr > 200 && b > 200) { left = Math.min(left, x); right = Math.max(right, x); }
          sum += r * 3 + gr * 5 + b * 7 + ((x * 31 + y * 17) % 97) * (r + gr + b);
        }
      const n = bmp.width * bmp.height;
      return { teal: teal / n, lit: lit / n, letters: right >= left ? (right - left + 1) / bmp.width : 0, sum };
    }, png);
  };
  const details = {};
  const origin = await page.evaluate(() => location.origin);
  const media = (name) => ({ src: `${origin}/fixtures/media/${name}` });
  const [camA, camB, talk, jpg, png] = await call("import_media", { files: ["sync-camera.mp4", "sync-camera-b.mp4", "interview-a.mp4", "photo.jpg", "photo.png"].map(media) });

  // ---- multicam ---------------------------------------------------------------
  const a = (await call("add_media_clip", { asset_id: camA.id, start: 0 })).added_clips[0].id;
  const over = (await call("add_track", { kind: "video", name: "Camera 2" })).added_tracks[0].id;
  const b = (await call("add_media_clip", { asset_id: camB.id, start: 4, track_id: over, fit: "fill" })).added_clips[0].id;
  const sync = await call("sync_audio", { clip_id: b, video_clip_id: a });
  const placed = (await call("describe_project", { clip_ids: [b], assets: false })).tracks.flatMap((t) => t.clips)[0];
  // The second camera started 1.5 s into the first one's file.
  details.sync = { ok: Math.abs(sync.offset + 1.5) < 0.05 && Math.abs(placed.start - 1.5) < 0.05 && sync.confidence > 0.3, offset: sync.offset, confidence: sync.confidence, start: placed.start };
  const sw = await call("switch_angles", { angles: [a, b], cuts: [{ at: 4, angle: b }, { at: 8, angle: a }], sound_from: a });
  const [before, during, after] = [await look(3), await look(5), await look(9)];
  const muted = await page.evaluate(([a, b]) => window.videoEditor.project().tracks.flatMap((t) => t.clips).filter((c) => c.id === a || c.id === b).map((c) => [c.id === a ? "a" : "b", !!c.muted]), [a, b]);
  details.angles = {
    ok: before.teal < 0.05 && during.teal > 0.7 && after.teal < 0.05 && /^Program: /.test(sw.notes[0]) && sw.notes.length === 1 && JSON.stringify(muted.sort()) === '[["a",false],["b",true]]',
    teal: [before.teal, during.teal, after.teal], notes: sw.notes, muted,
  };
  // An angle asked to show where it is not is refused, in seconds: the second camera ends before the first.
  const past = await rpc("switch_angles", { angles: [a, b], cuts: [{ at: 2, angle: b }] });
  details.refused = { ok: past.result.isError === true && /is asked to show from 2 s to 12 s but is on the timeline from 1\.5\d* s to 11\.5\d* s/.test(text(past)), said: text(past) };
  // Called again, the program is replaced, not cut finer.
  await call("switch_angles", { angles: [a, b], cuts: [{ at: 2, angle: b }, { at: 11, angle: a }] });
  const again = [await look(3), await look(9)];
  details.reswitch = { ok: again.every((f) => f.teal > 0.7), teal: again.map((f) => f.teal) };

  // ---- punch-ins on jump cuts ------------------------------------------------------
  // Straight after the first camera's 12 s, so the main track has no gap.
  const at = 12;
  const head = (await call("add_media_clip", { asset_id: talk.id, start: at })).added_clips[0].id;
  await call("cut_ranges", { clip_id: head, ranges: [{ start: 2, end: 3 }, { start: 5, end: 6 }] });
  const plain = [await look(at + 1), await look(at + 3), await look(at + 4.8)];
  const punched = await call("punch_in_cuts", {});
  const drawn = [await look(at + 1), await look(at + 3), await look(at + 4.8)];
  const grew = drawn[1].letters / plain[1].letters;
  details.punchIn = {
    ok: punched.notes[0] === "2 jump cuts: 1 of 3 pieces punched in to 1.15x." && Math.abs(grew - 1.15) < 0.03 && drawn[0].sum === plain[0].sum && drawn[2].sum === plain[2].sum,
    notes: punched.notes, grew, letters: [plain[1].letters, drawn[1].letters],
  };
  await call("punch_in_cuts", { scale: 1.25 });
  const more = (await look(at + 3)).letters / plain[1].letters;
  await call("punch_in_cuts", { off: true });
  details.punchAgain = { ok: Math.abs(more - 1.25) < 0.03 && (await look(at + 3)).sum === plain[1].sum, grew: more };

  // ---- a slideshow -------------------------------------------------------------------
  const show = await call("add_slideshow", { asset_ids: [jpg.id, png.id, jpg.id], seconds_each: 2 });
  const from = show.added_clips.reduce((m, c) => Math.min(m, c.start), Infinity);
  const [s1, s2, mix, next] = [await look(from + 0.2), await look(from + 1.2), await look(from + 2), await look(from + 3)];
  details.slideshow = {
    ok: show.added_clips.length === 3 && /^3 pictures from /.test(show.notes[0]) && [s1, s2, mix, next].every((f) => f.lit > 0.98) && s1.sum !== s2.sum && mix.sum !== s2.sum && mix.sum !== next.sum,
    notes: show.notes, lit: [s1.lit, s2.lit, mix.lit, next.lit],
  };
  // ---- a reel read as a shot list, before any of it is placed ---------------------------
  const [reel] = await call("import_media", { files: [media("three-shots.mp4")] });
  const sheet = await rpc("preview_media", { asset_id: reel.id, shots: true });
  const list = JSON.parse(sheet.result.content.find((c) => c.type === "text").text);
  details.shotList = {
    ok: sheet.result.content[0].type === "image" && list.total === 3 && list.shots.length === 3 && [0, 2, 4].every((t, i) => Math.abs(list.shots[i].start - t) < 0.08) && Math.abs(list.shots[2].end - 6) < 0.08,
    shots: list.shots, total: list.total,
  };

  // ---- a shot moved to the front, the others making room -------------------------------
  const order = async () => (await call("describe_project", { assets: false })).tracks.find((t) => t.main).clips.map((c) => c.id);
  const was = await order();
  await call("move_clip", { clip_id: was[was.length - 1], start: 0, mode: "insert" });
  const now = await order();
  details.reorder = { ok: now[0] === was[was.length - 1] && now.slice(1).join() === was.slice(0, -1).join(), was: was.length, first: now[0] };

  const check = await call("check_project", {});
  details.check = { ok: !check.findings.some((f) => f.level === "error"), verdict: check.verdict, rules: check.findings.map((f) => f.rule) };

  return { ok: Object.values(details).every((d) => d.ok), details };
};
