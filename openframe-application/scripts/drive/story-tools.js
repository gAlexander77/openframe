// J and L cuts, counting titles, a credits roll, caption keywords, a
// progress bar and export_frame, called over MCP as an agent calls them
// (ADR-147) and checked on what the mixer plays and the engine draws:
// - jl_cut: flash-beep-30.mp4 beeps half a second into every second, so
//   the beeps in the exported sound say whose sound plays where. An L cut
//   of 1 s plays the outgoing shot's next beep under the incoming picture
//   and drops the incoming shot's first; a J cut does the reverse.
// - add_counter: the held last number is drawn exactly as a plain title of
//   the same words, and the count's frames differ on the way there.
// - add_credits: nothing before the roll, lines moving up at the pace
//   asked, nothing after it.
// - highlight_words colors a caption's word; add_progress_bar is a quarter
//   full a quarter of the way in; export_frame says the browser cannot.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  let rpcId = 1;
  const rpc = (method, params) => page.evaluate(([method, params, id]) => window.videoEditor.mcp({ jsonrpc: "2.0", id, method, params }), [method, params, rpcId++]);
  const call = (name, args = {}) => rpc("tools/call", { name, arguments: args });
  const text = (r) => r.result.content.find((c) => c.type === "text")?.text ?? "";
  const json = async (name, args) => {
    const r = await call(name, args);
    if (r.result.isError) throw new Error(`${name}: ${text(r)}`);
    return JSON.parse(text(r));
  };
  const details = {};
  const near = (a, b, tol) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

  // ---- the tools are listed, and the playbook names them --------------------
  const listed = (await rpc("tools/list", {})).result.tools.map((t) => t.name);
  const added = ["jl_cut", "add_counter", "set_counter", "add_credits", "highlight_words", "add_progress_bar", "export_frame"];
  details.listed = { ok: added.every((n) => listed.includes(n)), missing: added.filter((n) => !listed.includes(n)) };
  const book = text(await call("help", { topic: "documentary" }));
  details.playbook = { ok: /get_transcript/.test(book) && /jl_cut/.test(book) && /add_credits/.test(book), length: book.length };

  // ---- J and L cuts, heard ---------------------------------------------------
  const origin = await page.evaluate(() => location.origin);
  const [asset] = await json("import_media", { files: [{ src: `${origin}/fixtures/media/flash-beep-30.mp4` }] });
  const a = (await json("add_media_clip", { asset_id: asset.id, start: 0, in: 0, duration: 3 })).added_clips[0].id;
  await json("add_media_clip", { asset_id: asset.id, start: 3, in: 5.25, duration: 3 });
  /** Seconds at which a beep starts in the first six seconds of the mix. */
  const beeps = () =>
    page.evaluate(async () => {
      const r = await window.videoEditor.render({ video: false, audioFormat: "wav", start: 0, end: 6 });
      const buf = await (await fetch(r.url)).arrayBuffer();
      URL.revokeObjectURL(r.url);
      const v = new DataView(buf);
      const channels = v.getUint16(22, true), rate = v.getUint32(24, true), step = channels * 2, win = Math.round(rate / 100);
      const out = [];
      let loud = false;
      for (let w = 0; 44 + (w + 1) * win * step <= buf.byteLength; w++) {
        let sum = 0;
        for (let i = 0; i < win; i++) sum += (v.getInt16(44 + (w * win + i) * step, true) / 32768) ** 2;
        const on = Math.sqrt(sum / win) > 0.05;
        if (on && !loud) out.push(+(w / 100).toFixed(2));
        loud = on;
      }
      return out;
    });
  const straight = await beeps();
  details.straightCut = { ok: near(straight, [0.5, 1.5, 2.5, 3.25, 4.25, 5.25], 0.04), beeps: straight };
  const l = await json("jl_cut", { clip_id: a, by: 1 });
  const lBeeps = await beeps();
  details.lCut = { ok: near(lBeeps, [0.5, 1.5, 2.5, 3.5, 4.25, 5.25], 0.04) && /^L cut/.test(l.notes?.[0] ?? ""), beeps: lBeeps, notes: l.notes };
  const j = await json("jl_cut", { clip_id: a, by: -1 });
  const jBeeps = await beeps();
  details.jCut = { ok: near(jBeeps, [0.5, 1.5, 2.25, 3.25, 4.25, 5.25], 0.04) && /^J cut/.test(j.notes?.[0] ?? ""), beeps: jBeeps, notes: j.notes };
  // The pictures never moved, and the sounds are two clips on one track.
  const tracks = (await json("describe_project", {})).tracks;
  const main = tracks.find((t) => t.main).clips.map((c) => [c.start, c.end]);
  const sound = tracks.filter((t) => t.kind === "audio").map((t) => t.clips.map((c) => [c.start, c.end]));
  details.timeline = { ok: JSON.stringify(main) === "[[0,3],[3,6]]" && JSON.stringify(sound) === "[[[0,2],[2,6]]]", main, sound };

  // ---- pictures ----------------------------------------------------------------
  const frame = async (at) => (await call("preview_frame", { at, max_width: 640 })).result.content[0].data;
  /** What a frame holds: how many pixels are lit, their mean row, yellow
   * ones, and how far right pink reaches in the bottom rows. */
  const look = (png) =>
    page.evaluate(async (png) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      let lit = 0, rows = 0, yellow = 0, pink = -1;
      for (let y = 0; y < bmp.height; y++)
        for (let x = 0; x < bmp.width; x++) {
          const i = (y * bmp.width + x) * 4, r = d[i], gr = d[i + 1], b = d[i + 2];
          if (r > 200 && gr < 110 && b > 60 && b < 170) { if (y >= bmp.height - 4) pink = Math.max(pink, x); continue; }
          if (r + gr + b > 380) { lit++; rows += y; }
          if (r > 220 && gr > 170 && b < 140) yellow++;
        }
      return { w: bmp.width, h: bmp.height, lit, row: lit ? rows / lit : null, yellow, pink };
    }, png);
  /** Pixels that differ between two frames. */
  const differ = (p1, p2) =>
    page.evaluate(async ([p1, p2]) => {
      const data = async (png) => {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height).data;
      };
      const [x, y] = [await data(p1), await data(p2)];
      let n = 0;
      for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 24) n++;
      return n;
    }, [p1, p2]);

  // ---- a counter: counts, holds, and its last number is a plain title's ---------
  const style = { size: 150 };
  const counter = await json("add_counter", { text: "{n}+ creators", from: 0, to: 12500, start: 7, duration: 3, count_seconds: 1.5, style });
  await json("add_text", { text: "12,500+ creators", start: 11, duration: 2, style });
  const [early, mid, held1, held2, plain] = [await frame(7.1), await frame(7.8), await frame(9), await frame(9.9), await frame(12)];
  const counting = await differ(early, mid), holding = await differ(held1, held2), asTitle = await differ(held2, plain);
  details.counter = { ok: counting > 200 && holding === 0 && asTitle === 0 && (await look(plain)).lit > 500, counting, holding, asTitle, added: counter.added_clips?.[0] };
  const timer = await json("set_counter", { clip_id: counter.added_clips[0].id, from: 90, to: 0, format: "time", count_seconds: 3 });
  details.setCounter = { ok: (await differ(held2, await frame(9))) > 200, changed: timer.changed_clips?.length };

  // ---- a credits roll -------------------------------------------------------------
  const names = Array.from({ length: 12 }, (_, i) => `Person Number ${i + 1}`).join("\n");
  const roll = await json("add_credits", { text: names, start: 14, line_seconds: 4 });
  const seconds = Number(/roll for ([\d.]+) s/.exec(roll.notes?.[0] ?? "")?.[1]);
  const [before, r1, r2, after] = [await look(await frame(14)), await look(await frame(16)), await look(await frame(17)), await look(await frame(14 + seconds + 0.2))];
  // A line crosses the frame in 4 s: a quarter of its height a second.
  // The first lit row, a share of the frame's height from its top.
  const top = async (at) =>
    page.evaluate(async (png) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) if (d[(y * bmp.width + x) * 4] > 160) return y / bmp.height;
      return null;
    }, await frame(at));
  const [t1, t2] = [await top(15), await top(16)];
  details.credits = {
    ok: before.lit === 0 && r1.lit > 300 && r2.lit > r1.lit && after.lit === 0 && Math.abs(t1 - t2 - 0.25) < 0.012 && roll.added_clips.length === 2 && // Twelve lines of the default type (size 56, line height 1.5) and the frame itself, at 4 s a frame.
      Math.abs(seconds - (1 + (12 * 56 * 1.5) / 1080) * 4) < 0.1,
    seconds, before: before.lit, during: [r1.lit, r2.lit], after: after.lit, firstLineTop: [t1, t2], notes: roll.notes,
  };

  // ---- caption keywords -------------------------------------------------------------
  await json("add_captions", { captions: [{ start: 23, end: 25, text: "It is free today" }] });
  const plainCaption = await look(await frame(24));
  const hi = await json("highlight_words", { words: ["free", "never"] });
  const marked = await look(await frame(24));
  details.highlight = { ok: plainCaption.yellow === 0 && marked.yellow > 30 && /Styled "free" 1 time\. Nothing says "never"\./.test(hi.notes?.[0] ?? ""), before: plainCaption.yellow, after: marked.yellow, notes: hi.notes };

  // ---- a progress bar -----------------------------------------------------------------
  await json("add_progress_bar", { color: "#ff3366", thickness: 12 });
  const quarter = await look(await frame(6.25)), start = await look(await frame(0.04));
  details.progressBar = { ok: Math.abs(quarter.pink / quarter.w - 0.25) < 0.02 && start.pink < 4, quarter: quarter.pink / quarter.w, start: start.pink };

  // ---- export_frame: the browser cannot write files, and says so -----------------------
  const cover = await call("export_frame", { at: 12, format: "jpg" });
  details.exportFrame = { ok: cover.result.isError === true && /desktop app only; preview_frame/.test(text(cover)), said: text(cover) };

  // ---- the check leaves the roll alone, and one undo takes the bar off -----------------
  const check = await json("check_project", {});
  const rules = (check.findings ?? []).filter((f) => roll.added_clips.some((c) => c.id === f.clip_id || (f.clip_ids ?? []).includes(c.id))).map((f) => f.rule);
  details.check = { ok: rules.length === 0, rules };
  await call("undo", {});
  details.undo = { ok: (await look(await frame(6.25))).pink < 0 };

  return { ok: Object.values(details).every((d) => d.ok), details };
};
