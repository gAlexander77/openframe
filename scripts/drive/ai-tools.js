// AI tools drive: proves Remove silences, Split scenes and Beat markers on
// fixtures whose answers are known, through window.videoEditor, then
// checks each edit is one undo step. Needs the dev server and fixtures
// (node scripts/make-fixtures.mjs: speech-gaps.m4a, talk-gaps.mp4,
// scene-cuts.mp4, beat-128.m4a).
//
// Run through the Playwright MCP tool `browser_run_code_unsafe` with
// filename "scripts/drive/ai-tools.js", or any Playwright page; pass a base
// URL as the second argument when the server is not on :1420. Returns
// { ok, details } — every check in details has ok: true when it passes.
async (page, base = "http://localhost:1420") => {
  // Each check starts from a fresh page with one fixture on the timeline.
  const fresh = async () => {
    await page.goto(base);
    await page.waitForFunction(() => !!window.videoEditor);
    // The app opens on the home screen; the panels exist only in a project.
    if (await page.locator(".create-card").count()) await page.locator(".create-card").click();
    await page.evaluate(() => {
      window.__place = async (name) => {
        const ve = window.videoEditor;
        const [a] = await ve.import([{ name, src: location.origin + "/fixtures/media/" + name }]);
        if (!a) throw new Error("import failed: " + name);
        ve.exec("add_media_clip", { asset_id: a.id, start: 0 });
        return { asset: a, clip: ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.asset === a.id) };
      };
    });
  };
  const run = (fn) => page.evaluate(fn);
  const details = {};
  const near = (got, want, tol) => got.length === want.length && got.every((g, i) => Math.abs(g - want[i]) <= tol);

  // 1. Silences in an audio clip: 1.6 s tones every 3 s, 12 s long. With
  //    the default 0.1 s padding the cuts are known to the window.
  await fresh();
  details.silences = await run(
    async () => {
      const ve = window.videoEditor;
      const { clip } = await window.__place("speech-gaps.m4a");
      const a = await ve.analyze.silences(clip.id);
      const r = await ve.ai.removeSilences(clip.id);
      const after = ve.describe().tracks.find((t) => t.kind === "audio").clips;
      const undoLabel = ve.state().undoLabel;
      ve.action("undo");
      const restored = ve.describe().tracks.find((t) => t.kind === "audio").clips;
      return { ranges: a.ranges, thresholdDb: a.thresholdDb, removed: r.removed, seconds: r.seconds, pieces: after.map((c) => [c.start, c.end, c.in]), undoLabel, restored: restored.map((c) => [c.start, c.end]) };
    },
  );
  {
    const d = details.silences;
    const want = [[1.7, 2.9], [4.7, 5.9], [7.7, 8.9], [10.7, 12]];
    d.ok =
      d.ranges.length === 4 &&
      d.ranges.every((r, i) => Math.abs(r.start - want[i][0]) <= 0.03 && Math.abs(r.end - want[i][1]) <= 0.03) &&
      d.removed === 4 &&
      Math.abs(d.seconds - 4.9) <= 0.1 &&
      d.pieces.length === 4 &&
      d.undoLabel === "Remove 4 silences" &&
      d.restored.length === 1 &&
      Math.abs(d.restored[0][1] - 12) < 0.05;
  }

  // 2. The same pattern on a video's sound: picture and sound cut together
  //    on the main track, which closes up.
  await fresh();
  details.videoSilences = await run(
    async () => {
      const ve = window.videoEditor;
      const { clip } = await window.__place("talk-gaps.mp4");
      const r = await ve.ai.removeSilences(clip.id);
      const main = ve.describe().tracks.find((t) => t.main).clips;
      return { removed: r.removed, seconds: r.seconds, main: main.map((c) => [c.start, c.end, c.in]), duration: ve.describe().duration };
    },
  );
  {
    const d = details.videoSilences;
    d.ok = d.removed === 4 && d.main.length === 4 && Math.abs(d.duration - 7.1) <= 0.1 && d.main.every((c, i) => i === 0 || Math.abs(c[0] - d.main[i - 1][1]) < 1e-6);
  }

  // 3. Scene cuts at 2.5, 5, 8 and 10 s (30 fps): both detectors within one
  //    frame, then a split into five clips as one undo step.
  await fresh();
  details.scenes = await run(
    async () => {
      const ve = window.videoEditor;
      const { clip } = await window.__place("scene-cuts.mp4");
      const t0 = performance.now();
      const adaptive = await ve.analyze.scenes(clip.id);
      const ms = performance.now() - t0;
      const content = await ve.analyze.scenes(clip.id, { detector: "content" });
      const r = await ve.ai.splitScenes(clip.id);
      const main = ve.describe().tracks.find((t) => t.main).clips;
      const undoLabel = ve.state().undoLabel;
      return { adaptive: adaptive.cuts, content: content.cuts, frames: adaptive.frames, ms: Math.round(ms), split: main.map((c) => [c.start, c.end]), undoLabel, output: r.output };
    },
  );
  {
    const d = details.scenes;
    const want = [2.5, 5, 8, 10];
    d.ok = near(d.adaptive, want, 1 / 30 + 1e-3) && near(d.content, want, 1 / 30 + 1e-3) && d.split.length === 5 && near(d.split.slice(1).map((c) => c[0]), want, 1 / 30 + 1e-3) && d.undoLabel === "Split into 5 scenes";
  }

  // 4. Beats of a 128 BPM loop starting at 0.25 s.
  await fresh();
  details.beats = await run(
    async () => {
      const ve = window.videoEditor;
      const { clip } = await window.__place("beat-128.m4a");
      const a = await ve.analyze.beats(clip.id);
      const r = await ve.ai.markBeats(clip.id);
      const markers = ve.describe().markers;
      const again = await ve.ai.markBeats(clip.id); // must not duplicate
      return { bpm: a.bpm, count: a.beats.length, beats: a.beats, markers: markers.length, label: markers[0]?.label, againMarkers: again.markers, undoLabel: ve.state().undoLabel };
    },
  );
  {
    const d = details.beats;
    const truth = Array.from({ length: 43 }, (_, k) => 0.25 + (k * 60) / 128).filter((t) => t < 20);
    const errs = d.beats.map((t) => Math.min(...truth.map((u) => Math.abs(u - t))));
    d.maxErrorMs = Math.round(Math.max(...errs) * 1000);
    d.truthCount = truth.length;
    d.ok = Math.abs(d.bpm - 128) <= 2 && d.count >= truth.length - 1 && d.count <= truth.length && d.maxErrorMs <= 34 && d.markers === d.count && d.againMarkers === 0 && d.label === "Beat";
    delete d.beats;
  }

  // 4b. Loudness: each clip measured as ffmpeg's ebur128 measures it (mono
  //     as dual mono, since it plays on both speakers), then set to the
  //     target, held back where the peak would clip, in one undo step.
  //     Reference: ffmpeg -af ebur128=peak=sample[:dualmono=true].
  await fresh();
  details.loudness = await run(async () => {
    const ve = window.videoEditor;
    const a = await window.__place("speech-test.wav");
    const b = await window.__place("music-stereo.m4a");
    const r = await ve.ai.normalizeLoudness([a.clip.id, b.clip.id], { target: -10 });
    const vol = (id) => ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.id === id).volume;
    const db = (g) => +(20 * Math.log10(g)).toFixed(2);
    return { measured: r.map((x) => x.lufs), limitedBy: r.map((x) => x.limitedBy), gainDb: [db(vol(a.clip.id)), db(vol(b.clip.id))], undoLabel: ve.state().undoLabel };
  });
  {
    const d = details.loudness;
    // ffmpeg reads -14.2 LUFS (speech, dual mono, peak -3.5 dBFS) and -14.6
    // (stereo music, peak -7.7). To reach -10 the speech would need +4.2 dB
    // and peak at +0.7, so it is held at the -1 dBFS ceiling: +2.5 dB.
    d.ok = near(d.measured, [-14.2, -14.6], 0.15) && near(d.gainDb, [2.5, 4.6], 0.2) && d.limitedBy[0] === "peak" && d.limitedBy[1] === null && d.undoLabel === "Normalize loudness of 2 clips";
  }

  // 4c. Ducking: music under a voice that talks in 1.6 s bursts every 3 s
  //     (speech-gaps.m4a; the silence check above finds speech at 0-1.7,
  //     2.9-4.7, 5.9-7.7 and 8.9-10.7 s). Each burst is its own dip (the
  //     1.2 s pauses outlast attack + release + hold), the music is down
  //     12 dB inside speech and back at full between, in one undo step.
  //     Then the music alone is exported and its level measured, so the
  //     keys are proven to reach the sound, not just the document.
  await fresh();
  details.ducking = await run(async () => {
    const ve = window.videoEditor;
    const music = await window.__place("music-30s.mp3");
    const voice = await window.__place("speech-gaps.m4a");
    const id = music.clip.id;
    ve.exec("trim_clip", { clip_id: id, edge: "end", to: 12 });
    const r = await ve.ai.duckUnderSpeech(id, { depth: 12 });
    const fps = ve.describe().fps;
    const db = (t) => +(20 * Math.log10(ve.paramAt(id, "volume", Math.round(t * fps)))).toFixed(2);
    const env = { speech: [0.8, 3.8, 6.8, 9.8].map(db), gaps: [2.5, 5.5, 8.5, 11.6].map(db) };
    const undoLabel = ve.state().undoLabel;
    // Music alone: mute the voice's track, render sound only.
    const vt = ve.describe().tracks.find((t) => t.clips.some((c) => c.id === voice.clip.id));
    ve.exec("update_track", { track_id: vt.id, muted: true });
    const out = await ve.render({ video: false, audioFormat: "wav" });
    const buf = await (await fetch(out.url)).arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 48000);
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    const rms = (a, b) => {
      let s = 0;
      const [i, j] = [Math.round(a * audio.sampleRate), Math.round(b * audio.sampleRate)];
      for (let k = i; k < j; k++) s += ch[k] * ch[k];
      return 10 * Math.log10(s / (j - i));
    };
    // The bed repeats every 4 s, so 2.2-2.6 s (a pause, back at full) and
    // 6.2-6.6 s (speech) are the same music: their level differs only by
    // the dip.
    const renderedDip = +(rms(2.2, 2.6) - rms(6.2, 6.6)).toFixed(2);
    return { ...r, env, undoLabel, renderedDip };
  });
  {
    const d = details.ducking;
    d.ok = d.dips === 4 && d.voices === 1 && d.env.speech.every((x) => Math.abs(x + 12) < 0.05) && d.env.gaps.every((x) => Math.abs(x) < 0.05) && d.undoLabel === "Duck under speech" && Math.abs(d.renderedDip - 12) < 1;
  }

  // 5. Through the UI once: the AI tools tab, settings popover (Escape must
  //    close it without deselecting the clip), Remove, result on the card.
  await fresh();
  await page.evaluate(async () => {
    const { clip } = await window.__place("talk-gaps.mp4");
    window.videoEditor.select([clip.id]);
  });
  await page.getByRole("tab", { name: "AI tools" }).click();
  await page.getByRole("button", { name: "Remove silences settings" }).click();
  await page.keyboard.press("Escape");
  const kept = await page.evaluate(() => window.videoEditor.state().selection.length);
  await page.locator(".ai-silences .ai-run").click();
  await page.waitForSelector(".ai-silences .ai-status.done", { timeout: 30000 });
  await page.screenshot({ path: "scripts/drive/shots/ai-tools.png" }).catch(() => {});
  details.ui = await page.evaluate(() => ({
    status: document.querySelector(".ai-silences .ai-status").textContent.trim(),
    pieces: window.videoEditor.describe().tracks.find((t) => t.main).clips.length,
    popoverOpen: !!document.querySelector(".ai-pop"),
  }));
  details.ui.selectionKeptAfterEscape = kept === 1;
  details.ui.ok = details.ui.selectionKeptAfterEscape && !details.ui.popoverOpen && details.ui.pieces === 4 && details.ui.status === "Removed 4 silences, 4.9 s shorter";

  return { ok: Object.values(details).every((d) => d.ok), details };
};
