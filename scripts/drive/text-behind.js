// Text behind the subject: a huge yellow title over person-pan.mp4 (the
// CC0 portrait), then the MCP tool text_behind_subject. The background
// model runs headless here (the first use downloads it; with no network
// the drive reports the tool's message and skips the pixel checks). The
// copy of the video lands on a "Subject" track above the title with the
// matte on, silent and grouped with the original, in one undo step; over
// the person the title's yellow drops (the person now covers it), while
// beside the person it is untouched; hiding the Subject track brings it
// back. Screenshot: scratch/text-behind.png.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const ids = await page.evaluate(async () => {
    const v = window.videoEditor;
    const [a] = await v.import([{ name: "person-pan.mp4", src: `${location.origin}/fixtures/media/person-pan.mp4` }]);
    v.exec("add_media_clip", { asset_id: a.id, start: 0, duration: 3 });
    v.exec("add_text", { text: "BOLD", start: 0, duration: 3, y: 0.05, style: { size: 420, color: "#ffff00" } });
    const clips = v.project().tracks.flatMap((t) => t.clips);
    return { video: clips.find((c) => c.type === "video").id, text: clips.find((c) => c.type === "text").id };
  });
  const mcp = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const started = Date.now();
  const r = await mcp("text_behind_subject", { clip_id: ids.video, text_clip_ids: [ids.text] });
  const answer = r.result.content[0].text;
  details.seconds = { ok: true, seconds: (Date.now() - started) / 1000 };
  if (r.result.isError) {
    // The model could not be fetched (offline): say so, check nothing else.
    details.tool = { ok: /download|internet|network|fetch/i.test(answer), skipped: true, answer };
    return { ok: Object.values(details).every((d) => d.ok), details };
  }
  const res = JSON.parse(answer);
  const s = await page.evaluate(([ids, subject]) => {
    const p = window.videoEditor.project();
    const index = (id) => p.tracks.findIndex((t) => t.clips.some((c) => c.id === id));
    const clip = (id) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    const sub = clip(subject), vid = clip(ids.video);
    return {
      order: [index(subject), index(ids.text), index(ids.video)],
      track: p.tracks[index(subject)].name,
      cutout: !!sub.cutout?.enabled,
      muted: sub.muted,
      originalCut: !!vid.cutout,
      grouped: !!sub.group && sub.group === vid.group,
      undo: window.videoEditor.state().undoLabel,
    };
  }, [ids, res.subjectClipId]);
  details.structure = { ok: s.order[0] < s.order[1] && s.order[1] < s.order[2] && s.track === "Subject" && s.cutout && s.muted && !s.originalCut && s.grouped && s.undo === "Text behind subject", ...s };

  // Yellow in a region of the frame at frame 30.
  const yellow = (rect) =>
    page.evaluate(async (rect) => {
      const v = window.videoEditor;
      v.seek(30);
      await new Promise((r) => setTimeout(r, 60));
      await v.rendered();
      const { width, height, data } = v.pixels();
      let n = 0, hit = 0;
      for (let y = Math.floor(rect[1] * height); y < rect[3] * height; y++)
        for (let x = Math.floor(rect[0] * width); x < rect[2] * width; x++) {
          const i = (y * width + x) * 4;
          n++;
          if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] < 90) hit++;
        }
      return +(hit / n).toFixed(4);
    }, rect);
  // The jacket under the face, and the B left of the person.
  const PERSON = [0.4, 0.42, 0.52, 0.72], BESIDE = [0.21, 0.4, 0.29, 0.62];
  const front = { person: await yellow(PERSON), beside: await yellow(BESIDE) };
  await page.locator(".player-frame").screenshot({ path: "__REPO__/scratch/text-behind.png" });
  const subjectTrack = await page.evaluate((id) => window.videoEditor.project().tracks.find((t) => t.clips.some((c) => c.id === id)).id, res.subjectClipId);
  await mcp("update_track", { track_id: subjectTrack, hidden: true });
  const hidden = { person: await yellow(PERSON), beside: await yellow(BESIDE) };
  details.covered = { ok: hidden.person > 0.15 && front.person < hidden.person * 0.5 && front.beside > 0.9 * hidden.beside && front.beside > 0.1, front, hidden };
  // Undo the two track changes, then one undo takes it all back.
  await mcp("update_track", { track_id: subjectTrack, hidden: false });
  await mcp("undo", {});
  await mcp("undo", {});
  await mcp("undo", {});
  const after = await page.evaluate(() => ({ clips: window.videoEditor.project().tracks.flatMap((t) => t.clips).length, subject: window.videoEditor.project().tracks.some((t) => t.name === "Subject") }));
  details.undo = { ok: after.clips === 2 && !after.subject, after };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
