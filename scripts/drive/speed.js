// Speed drive: proves ramps, reverse and pitch in the running product.
//   - picture: every timeline frame of a ramped / reversed clip shows exactly
//     the source frame the time map predicts (framecode fixture, pixels);
//   - reverse at full size (what export reads) returns the decoder's own
//     pixels, frame for frame, backward;
//   - sound: beep onsets land on the flash frames through a ramp and a
//     reversed ramp, offline (export's path) and on the live AudioContext;
//   - pitch: a 440 Hz tone stays 440 Hz when pitch is kept and follows the
//     speed when Change pitch is on.
// Needs the dev server and fixtures (node scripts/make-fixtures.mjs).
//
// Run through the Playwright MCP tool `browser_run_code_unsafe` with
// filename "scripts/drive/speed.js", or any Playwright page. Opens on the
// page's own origin when it is a localhost dev server, else :1420.
// Returns { ok, details }.
async (page) => {
  const here = page.url();
  const base = /^http:\/\/localhost:\d+/.test(here) ? new URL(here).origin : "http://localhost:1420";
  if (!here.startsWith(base)) await page.goto(base);
  await page.waitForFunction(() => !!window.videoEditor);
  // The viewer exists only in the editor: open a fresh project.
  if (await page.locator(".create-card").count()) await page.locator(".create-card").click();
  await page.waitForSelector("canvas");
  return await page.evaluate(async (base) => {
    const ve = window.videoEditor;
    const ops = await import("/src/lib/project/ops.ts");
    const { scheduleAudio, audioContext } = await import("/src/engine/audio.ts");
    const { CursorPool } = await import("/src/engine/player.ts");
    const names = ["framecode-30.mp4", "flash-beep-30.mp4", "h264-1080p30.mp4", "h264-720p60-longgop.mp4"];
    const [code, flash, tone, longgop] = await ve.import(names.map((name) => ({ name, src: `${base}/fixtures/media/${name}` })));
    const details = {};
    const fails = [];
    const check = (name, pass, info) => {
      details[name] = { pass, ...info };
      if (!pass) fails.push(name);
    };

    const clear = () => {
      const ids = ve.project().tracks.flatMap((t) => t.clips.map((c) => c.id));
      if (ids.length) ve.exec("delete_clips", { clip_ids: ids });
    };
    const place = (asset, opts = {}) => {
      clear();
      ve.exec("add_media_clip", { asset_id: asset.id, start: 0, in: 0, duration: 10, ...opts });
      return ve.project().tracks[0].clips[0].id;
    };
    const clip = (id) => ops.findClip(ve.project(), id).clip;
    const pixels = async (f) => {
      ve.seek(f);
      await new Promise((r) => setTimeout(r, 0));
      await ve.rendered();
      return ve.pixels();
    };
    const framecode = ({ width: w, height: h, data }) => {
      let n = 0;
      for (let i = 0; i < 10; i++) if (data[(Math.floor(h / 2) * w + Math.floor(((i + 0.5) * w) / 10)) * 4] > 128) n |= 1 << i;
      return n;
    };
    const fps = () => ve.project().fps;
    /** Source frame the model says frame f shows (the plan's quarter-frame guard included). */
    const predicted = (c, f) => Math.min(299, Math.max(0, Math.floor((ops.sourceTimeAt(c, f, fps()) + 0.25 / 30) * 30)));

    // ---- picture -------------------------------------------------------------
    const everyFrame = async (id, order) => {
      const c = clip(id);
      const frames = order ?? Array.from({ length: c.duration }, (_, k) => c.start + k);
      const bad = [];
      const shown = [];
      const t0 = performance.now();
      for (const f of frames) {
        const got = framecode(await pixels(f));
        shown.push(got);
        if (got !== predicted(c, f)) bad.push({ f, want: predicted(c, f), got });
      }
      return { frames: frames.length, duration: c.duration, msPerFrame: +((performance.now() - t0) / frames.length).toFixed(1), first: shown.slice(0, 6), last: shown.slice(-3), bad: bad.slice(0, 5) };
    };
    let id = place(code);
    ve.exec("set_speed_curve", { clip_id: id, preset: "montage" });
    let r = await everyFrame(id);
    check("ramp montage: every frame is the predicted source frame", r.bad.length === 0 && r.last[2] >= 296, r);
    ve.exec("set_reverse", { clip_id: id, reverse: true });
    r = await everyFrame(id);
    check("reversed montage: every frame predicted, running backward", r.bad.length === 0 && r.first[0] >= 296 && r.last[2] <= 3, r);
    ve.exec("set_speed_curve", { clip_id: id, preset: "none" });
    r = await everyFrame(id);
    const descending = r.first.every((n, k) => n === 299 - k);
    check("reverse 1x: frames 299, 298, ... 0", r.bad.length === 0 && descending && r.duration === 300, r);
    ve.exec("set_speed_curve", { clip_id: id, preset: "bullet" });
    const c0 = clip(id);
    const shuffled = Array.from({ length: 80 }, (_, k) => (k * 37) % c0.duration);
    r = await everyFrame(id, shuffled);
    check("reversed bullet, random access both ways", r.bad.length === 0, r);

    // ---- durations: span / mean speed, source range kept ---------------------
    const durations = {};
    for (const preset of ["montage", "hero", "bullet", "jumpCut", "flashIn", "flashOut"]) {
      id = place(code);
      ve.exec("set_speed_curve", { clip_id: id, preset });
      const c = clip(id);
      const [lo, hi] = ops.sourceRange(c, fps());
      const firstShown = framecode(await pixels(0));
      const lastShown = framecode(await pixels(c.duration - 1));
      durations[preset] = { frames: c.duration, seconds: +(c.duration / 30).toFixed(2), range: [+lo.toFixed(3), +hi.toFixed(3)], firstShown, lastShown };
    }
    check(
      "every preset keeps the 10 s source range; first and last frames are the source's ends",
      Object.values(durations).every((d) => d.range[0] === 0 && Math.abs(d.range[1] - 10) < 0.35 && d.firstShown === 0 && d.lastShown >= 290),
      durations,
    );

    // ---- reverse at full size (export's cursor) --------------------------------
    {
      const pool = new CursorPool();
      const cur = await pool.getReverse(ve.project(), "exact", code.id);
      const cv = new OffscreenCanvas(640, 360);
      const g = cv.getContext("2d", { willReadFrequently: true });
      const got = [];
      for (let k = 0; k < 120; k++) {
        const fr = await cur.frameAt((200 - k) / 30 + 0.25 / 30);
        g.drawImage(fr.image, 0, 0, 640, 360);
        got.push(framecode({ width: 640, height: 360, data: g.getImageData(0, 0, 640, 360).data }));
      }
      const fullSize = (await cur.frameAt(1)).image.width;
      pool.clear();
      const want = got.map((_, k) => 200 - k);
      check("reverse cursor at full size returns frames 200, 199, ... 81 exactly", fullSize === 640 && got.every((n, k) => n === want[k]), { first: got.slice(0, 5), last: got.slice(-3), fullSize });
    }
    {
      // 1080p: the reversed bitmap is the decoder's own pixels.
      const pool = new CursorPool();
      const rev = await pool.getReverse(ve.project(), "rev", tone.id);
      const fwd = await pool.get(ve.project(), "fwd", tone.id);
      const a = new OffscreenCanvas(1920, 1080).getContext("2d", { willReadFrequently: true });
      const b = new OffscreenCanvas(1920, 1080).getContext("2d", { willReadFrequently: true });
      let maxDiff = 0;
      for (const sec of [3.0, 2.5, 1.2]) {
        const t = sec + 0.25 / 30;
        const fr = await rev.frameAt(t);
        a.drawImage(fr.image, 0, 0);
        const s = await fwd.frameAt(t);
        b.drawImage(s.toCanvasImageSource(), 0, 0);
        const da = a.getImageData(0, 0, 1920, 1080).data;
        const db = b.getImageData(0, 0, 1920, 1080).data;
        for (let i = 0; i < da.length; i += 4) maxDiff = Math.max(maxDiff, Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      }
      pool.clear();
      check("reversed 1080p frames match forward-decoded pixels", maxDiff <= 2, { maxChannelDiff: maxDiff });
    }

    // ---- sound on picture ----------------------------------------------------------
    const RATE = 48000;
    // Sound may sit within 20 ms of where the time map puts it: pitch-kept
    // stretching (WSOLA) places a new sound within about ±16 ms
    // (src/lib/stretch.test.ts); EBU R37 tolerates +40/-60 ms.
    const AUDIO_MS = 20;
    const mixdown = async (from, to) => {
      const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: Math.ceil((to - from) * RATE), sampleRate: RATE });
      const s = scheduleAudio(ctx, ctx.destination, ve.project(), from, to, 0);
      await s.done;
      return (await ctx.startRendering()).getChannelData(0);
    };
    const onsets = (x, rate, thr = 0.25) => {
      const out = [];
      let quiet = rate;
      for (let i = 0; i < x.length; i++) {
        if (Math.abs(x[i]) > thr) {
          if (quiet >= 0.04 * rate) out.push(i / rate);
          quiet = 0;
        } else quiet++;
      }
      return out;
    };
    /** Timeline seconds where the model says each beep starts (its end, reversed). */
    const beepTimes = (c) => {
      const out = [];
      for (let k = 0; k < 10; k++) {
        const s = c.reverse ? 0.6 + k : 0.5 + k;
        const x = ops.framesForSource(c, c.reverse ? c.in - s : s - c.in, fps());
        if (x >= 0 && x < c.duration) out.push((c.start + x) / 30);
      }
      return out;
    };
    const flashTimes = async (c) => {
      const out = [];
      let was = true;
      for (let f = c.start; f < c.start + c.duration; f++) {
        const { width: w, height: h, data } = await pixels(f);
        const white = data[(Math.floor(h / 2) * w + Math.floor(w / 2)) * 4] > 128;
        if (white && !was) out.push(f / 30);
        was = white;
      }
      return out;
    };
    const nearest = (xs, t) => xs.reduce((m, x) => (Math.abs(x - t) < Math.abs(m - t) ? x : m), Infinity);
    const syncCase = async (label, setup) => {
      id = place(flash);
      setup(id);
      const c = clip(id);
      const end = c.duration / 30;
      const heard = onsets(await mixdown(0, end), RATE);
      const model = beepTimes(c);
      const seen = await flashTimes(c);
      const vsModel = model.map((t) => +((nearest(heard, t) - t) * 1000).toFixed(1));
      // Every flash on screen has its beep within a frame (a flash shorter
      // than a frame of fast footage can fall between frames: not counted).
      const vsFlash = seen.map((t) => +((t - nearest(heard, t)) * 1000).toFixed(1));
      const pass = heard.length === model.length && vsModel.every((e) => Math.abs(e) <= AUDIO_MS) && seen.length >= 3 && vsFlash.every((e) => Math.abs(e) <= 1000 / 30 + AUDIO_MS);
      check(`sound on picture: ${label}`, pass, { beeps: heard.length, expected: model.length, flashesSeen: seen.length, audioVsModelMs: vsModel, flashMinusBeepMs: vsFlash });
      return c;
    };
    await syncCase("montage ramp, pitch kept", (id) => ve.exec("set_speed_curve", { clip_id: id, preset: "montage" }));
    await syncCase("reversed bullet ramp", (id) => {
      ve.exec("set_speed_curve", { clip_id: id, preset: "bullet" });
      ve.exec("set_reverse", { clip_id: id, reverse: true });
    });
    await syncCase("flash in, Change pitch on", (id) => {
      ve.exec("set_speed_curve", { clip_id: id, preset: "flashIn" });
      ve.exec("set_preserve_pitch", { clip_id: id, preserve: false });
    });
    await syncCase("constant 0.5x, pitch kept", (id) => ve.exec("set_speed", { clip_id: id, speed: 0.5 }));

    // The live AudioContext (preview): record what scheduleAudio plays with
    // an AudioWorklet that stamps every quantum with its context time.
    {
      id = place(flash);
      ve.exec("set_speed_curve", { clip_id: id, preset: "hero" });
      const c = clip(id);
      const ctx = audioContext();
      await ctx.resume();
      const code = `class Rec extends AudioWorkletProcessor { process(i) { const ch = i[0][0]; if (ch) this.port.postMessage({ t: currentTime, d: ch.slice() }); return true; } } registerProcessor("rec", Rec);`;
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
      const rec = new AudioWorkletNode(ctx, "rec");
      const quanta = [];
      rec.port.onmessage = (e) => quanta.push(e.data);
      rec.connect(ctx.destination);
      const sum = ctx.createGain();
      sum.connect(rec);
      const span = Math.min(6, c.duration / 30);
      const at = ctx.currentTime + 0.3;
      const s = scheduleAudio(ctx, sum, ve.project(), 0, span, at);
      await new Promise((r) => setTimeout(r, (span + 0.8) * 1000));
      s.stop();
      rec.disconnect();
      const heard = [];
      let quiet = ctx.sampleRate;
      for (const q of quanta) {
        for (let i = 0; i < q.d.length; i++) {
          if (Math.abs(q.d[i]) > 0.25) {
            if (quiet >= 0.04 * ctx.sampleRate) heard.push(q.t + i / ctx.sampleRate - at);
            quiet = 0;
          } else quiet++;
        }
      }
      const model = beepTimes(c).filter((t) => t < span - 0.05);
      const err = model.map((t) => +((nearest(heard, t) - t) * 1000).toFixed(1));
      check("sound on picture: live AudioContext (hero ramp)", heard.length >= model.length && model.length > 2 && err.every((e) => Math.abs(e) <= AUDIO_MS), { beeps: heard.length, expected: model.length, audioVsModelMs: err, contextRate: ctx.sampleRate });
    }

    // ---- pitch -------------------------------------------------------------------
    const freq = (x, a, b) => {
      const ups = [];
      for (let i = Math.max(1, Math.round(a * RATE)); i < Math.min(x.length, Math.round(b * RATE)); i++) if (x[i - 1] < 0 && x[i] >= 0) ups.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]));
      return ups.length > 2 ? ((ups.length - 1) * RATE) / (ups[ups.length - 1] - ups[0]) : 0;
    };
    const pitch = {};
    for (const [label, speed, preserve] of [["0.5x kept", 0.5, true], ["0.5x changed", 0.5, false], ["2x kept", 2, true], ["2x changed", 2, false]]) {
      id = place(tone, { duration: 8 });
      ve.exec("set_speed", { clip_id: id, speed });
      ve.exec("set_preserve_pitch", { clip_id: id, preserve });
      const x = await mixdown(0.5, 3.5);
      pitch[label] = { hz: +freq(x, 0.2, 2.8).toFixed(1), want: preserve ? 440 : 440 * speed };
    }
    // Ramps: kept pitch stays 440 everywhere; changed pitch follows the
    // source rate in each 0.1 s window (cycles of source per second).
    const ramp = { kept: [], changed: [] };
    for (const preserve of [true, false]) {
      id = place(tone, { duration: 8 });
      ve.exec("set_speed_curve", { clip_id: id, preset: "bullet" });
      ve.exec("set_preserve_pitch", { clip_id: id, preserve });
      const c = clip(id);
      const end = c.duration / 30;
      const x = await mixdown(0, end);
      for (let t = 0.2; t + 0.1 < end - 0.2; t += 0.35) {
        const src = (s) => ops.sourceOffset(c, s * 30, fps());
        const want = preserve ? 440 : (440 * (src(t + 0.1) - src(t))) / 0.1;
        (preserve ? ramp.kept : ramp.changed).push({ t: +t.toFixed(2), hz: +freq(x, t, t + 0.1).toFixed(0), want: +want.toFixed(0) });
      }
    }
    const within = (got, want, tol) => Math.abs(got - want) <= want * tol;
    check("pitch kept / changed at constant speed", Object.values(pitch).every((v) => within(v.hz, v.want, 0.01)), pitch);
    check("pitch through a bullet ramp: kept stays 440 Hz, changed follows the rate", ramp.kept.every((v) => within(v.hz, 440, 0.02)) && ramp.changed.every((v) => within(v.hz, v.want, 0.05)), ramp);

    // ---- audio cost: offline render speed of each path (8 s of timeline) ----------
    const audioCost = {};
    for (const [label, setup] of [
      ["1x (playbackRate)", () => {}],
      ["0.5x Change pitch (varispeed)", (id) => { ve.exec("set_speed", { clip_id: id, speed: 0.5 }); ve.exec("set_preserve_pitch", { clip_id: id, preserve: false }); }],
      ["0.5x pitch kept (WSOLA)", (id) => ve.exec("set_speed", { clip_id: id, speed: 0.5 })],
      ["bullet ramp, reversed (WSOLA)", (id) => { ve.exec("set_speed_curve", { clip_id: id, preset: "bullet" }); ve.exec("set_reverse", { clip_id: id, reverse: true }); }],
    ]) {
      id = place(tone, { duration: 10 });
      setup(id);
      const t0 = performance.now();
      await mixdown(0, 8);
      const sec = (performance.now() - t0) / 1000;
      audioCost[label] = { renderMs: Math.round(sec * 1000), timesRealtime: Math.round(8 / sec) };
    }
    check("retimed sound renders many times faster than real time", Object.values(audioCost).every((v) => v.timesRealtime >= 4), audioCost);

    // ---- reverse cost ------------------------------------------------------------------
    const cost = {};
    for (const a of [code, tone, longgop]) {
      id = place(a, { duration: 4 });
      const fwd = await everyFrameTime(id);
      ve.exec("set_reverse", { clip_id: id, reverse: true });
      const rev = await everyFrameTime(id);
      cost[`${a.width}x${a.height}@${a.fps}`] = { forwardMsPerFrame: fwd, reverseMsPerFrame: rev };
    }
    async function everyFrameTime(id) {
      const c = clip(id);
      const n = Math.min(90, c.duration);
      const t0 = performance.now();
      for (let f = 0; f < n; f++) await pixels(f);
      return +((performance.now() - t0) / n).toFixed(1);
    }
    check("stepping a reversed clip costs about what forward does (seek + render)", Object.values(cost).every((v) => v.reverseMsPerFrame < 3 * v.forwardMsPerFrame + 10), cost);

    clear();
    return { ok: fails.length === 0, failed: fails, details };
  }, base);
};
