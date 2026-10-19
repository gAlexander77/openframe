// Long-GOP cut drive: live playback through cuts into clips that start late
// in a source with ffmpeg's default 8 s key frame interval
// (scratch/longgop-1080p30.mp4, key frames at 0 and 8 s only).
//   - A: source 0-3 s at 0-3 s.
//   - B: source 7-9 s at 3-5 s, a hard cut at frame 90 (210 frames to
//     decode from the key frame before its first one).
//   - C: source 6.5-9.5 s at 5-8 s, joined to B by a 10-frame zoom punch
//     centered on frame 150 (it needs C's frames from 145, before its cut).
// Each pass plays from 0 to 7 s with sound and logs when every timeline
// frame was first drawn. At each cut it reports the longest wall-clock gap
// between two drawn frames (a stall), the frames never drawn, and how many
// of the transition's frames were drawn. Paused, the cut frames must show
// the exact source frames (frame numbers read from the picture).
// Needs: node scripts/make-fixtures.mjs longgop-1080p30
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const result = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: "longgop-1080p30.mp4", src: "http://localhost:1420/scratch/longgop-1080p30.mp4" }]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0, in: 0, duration: 3 });
    ve.exec("add_media_clip", { asset_id: a.id, start: 3, in: 7, duration: 2 });
    ve.exec("add_media_clip", { asset_id: a.id, start: 5, in: 6.5, duration: 3 });
    const video = () => ve.describe().tracks.find((t) => t.kind === "video").clips;
    const b = video().find((c) => c.start === 3);
    ve.exec("set_transition", { clip_id: b.id, type: "zoomPunch", duration: 10 / 30 });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const read = () => {
      // Frame number in ten blocks across the top band (120 of 1080 rows).
      const { width: w, height: h, data } = ve.pixels();
      const y = Math.floor(h * (60 / 1080));
      let n = 0;
      for (let i = 0; i < 10; i++) if (data[(y * w + Math.floor(((i + 0.5) * w) / 10)) * 4] > 128) n |= 1 << i;
      return n;
    };

    const pass = async () => {
      ve.seek(0);
      await sleep(200);
      await ve.rendered();
      const first = new Map();
      const off = ve.onFrame((f) => {
        if (!first.has(f)) first.set(f, performance.now());
      });
      ve.action("playPause");
      while (!ve.state().playing) await sleep(10);
      while (ve.state().playhead < 210 && ve.state().playing) await sleep(20);
      ve.action("playPause");
      off();
      const at = (cut, from, to, window) => {
        const frames = [...first.keys()].filter((f) => f >= from && f < to).sort((x, y) => x - y);
        let gap = 0;
        for (let i = 1; i < frames.length; i++) gap = Math.max(gap, first.get(frames[i]) - first.get(frames[i - 1]));
        const missing = [];
        for (let f = from; f < to; f++) if (!first.has(f)) missing.push(f);
        const out = { cut, longestGapMs: Math.round(gap), dropped: missing.length, missing: missing.slice(0, 20) };
        if (window) out.transitionFramesDrawn = `${window.filter((f) => first.has(f)).length} of ${window.length}`;
        return out;
      };
      const tw = Array.from({ length: 10 }, (_, i) => 145 + i);
      const stats = ve.playbackStats?.();
      return { hardCut: at(90, 75, 120), transitionCut: at(150, 135, 180, tw), steady: at(null, 15, 75), prepared: stats?.prepared.slice(-2), decodeRate: stats?.decodeRate };
    };

    const passes = [await pass(), await pass()];

    // Exact frames, paused, outside the transition: B's first frame is
    // source frame 210 and its last before the punch 264; C shows 200 at
    // frame 155 (6.5 s + 5 frames).
    const exact = [];
    for (const [f, want] of [[89, 89], [90, 210], [144, 264], [155, 200], [200, 245]]) {
      ve.seek(f);
      await sleep(30);
      await ve.rendered();
      exact.push({ f, want, got: read() });
    }
    return { passes, exact };
  });
  const smooth = (c) => c.longestGapMs < 150 && c.dropped <= 3;
  const details = {
    hardCut: { ok: result.passes.every((p) => smooth(p.hardCut)), passes: result.passes.map((p) => p.hardCut) },
    transitionCut: { ok: result.passes.every((p) => smooth(p.transitionCut) && Number(p.transitionCut.transitionFramesDrawn.split(" ")[0]) >= 8), passes: result.passes.map((p) => p.transitionCut) },
    steady: { ok: true, passes: result.passes.map((p) => p.steady) },
    prepared: { ok: true, passes: result.passes.map((p) => ({ decodeRate: p.decodeRate, cuts: p.prepared })) },
    exact: { ok: result.exact.every((e) => e.got === e.want), frames: result.exact },
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
