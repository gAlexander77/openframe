// The social_short playbook (help topic social_short), run over MCP the
// way an agent runs it, on a synthesized talking head (interview-a.mp4):
// a tall canvas, the take framed before it is cut up, its pauses removed,
// the jump cuts punched in, captions a few words at a time with keywords,
// a hook, a progress bar, the check. What it holds the tools to (ADR-148):
// - a piece cut out of a framed take keeps the framing, and punch_in_cuts
//   scales it about the speaker (the frame stays filled, the words grow);
// - the captions say every word that still plays after the cuts;
// - check_project kind social_short finds no error in what the playbook
//   made.
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
  /** A frame's lit share and how tall its white letters stand, of the frame's height. */
  const look = async (at) => {
    const png = (await rpc("preview_frame", { at, max_width: 540 })).result.content[0].data;
    return page.evaluate(async (png) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      // The picture's own words sit in the middle band; captions and the hook are kept out of the measure.
      const y0 = Math.round(bmp.height * 0.4), y1 = Math.round(bmp.height * 0.6);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      let lit = 0, top = bmp.height, bottom = -1;
      for (let y = 0; y < bmp.height; y++)
        for (let x = 0; x < bmp.width; x++) {
          const i = (y * bmp.width + x) * 4;
          if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
          if (y >= y0 && y < y1 && d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
        }
      return { w: bmp.width, h: bmp.height, lit: lit / (bmp.width * bmp.height), letters: bottom >= top ? (bottom - top + 1) / bmp.height : 0 };
    }, png);
  };
  const details = {};
  const squash = (s) => s.replace(/\s+/g, "");
  const origin = await page.evaluate(() => location.origin);

  // 1-2. A tall canvas; the take on it, framed before it is cut up.
  await call("set_project", { width: 1080, height: 1920 });
  const [talk] = await call("import_media", { files: [{ src: `${origin}/fixtures/media/interview-a.mp4` }] });
  const clip = (await call("add_media_clip", { asset_id: talk.id, start: 0 })).added_clips[0].id;
  await call("frame_region", { clip_id: clip, region: { x: 0.25, y: 0, w: 0.5, h: 1 } });
  const framed = await look(1.5);
  details.framed = { ok: framed.h > framed.w && framed.lit > 0.98, lit: framed.lit, letters: framed.letters };

  // 3. A sentence that wanders goes, then the pauses; the jump cut that is left is punched in.
  const heard = (await call("get_transcript", { clip_id: clip })).words;
  const g = heard.findIndex((w) => /garage/i.test(w.text)), t = heard.findIndex((w) => /^then/i.test(w.text.trim()));
  await call("cut_ranges", { clip_id: clip, ranges: [{ start: heard[g].end + 0.03, end: heard[t].start - 0.05 }] });
  const words = [...heard.slice(0, g + 1), ...heard.slice(t)];
  const cut = [];
  for (const c of (await call("describe_project", { assets: false })).tracks.find((x) => x.main).clips) cut.push(await call("remove_silences", { clip_id: c.id }));
  const pieces = (await call("describe_project", { assets: false })).tracks.find((t) => t.main).clips;
  const punch = await call("punch_in_cuts", {});
  const after = (await call("describe_project", { assets: false })).tracks.find((t) => t.main).clips;
  const mid = (c) => (c.start + c.end) / 2;
  const [plain, big] = [await look(mid(after[0])), await look(mid(after[1]))];
  details.punchIn = {
    ok: pieces.length >= 2 && /jump cuts?: \d+ of \d+ pieces punched in to 1\.15x\.$/.test(punch.notes[0]) && after[1].punch_in === 1.15 && !after[0].punch_in && Math.abs(big.letters / plain.letters - 1.15) < 0.04 && big.lit > 0.98,
    pieces: pieces.length, notes: punch.notes, grew: big.letters / plain.letters, removed: cut,
  };

  // 4. Captions a few words at a time, the words that carry the point marked.
  const caps = (await call("auto_captions", { words_per_caption: 3, look: "pop", detail: "full" })).captions;
  const shown = squash(caps.map((c) => c.text).join(" ")).toLowerCase();
  const said = squash(words.map((w) => w.text).join("")).toLowerCase();
  const hi = await call("highlight_words", { words: ["studio", "everything"] });
  details.captions = { ok: shown === said && caps.every((c) => c.text.trim().split(/\s+/).length <= 3) && /Styled "studio" 1 time, "everything" 1 time\./.test(hi.notes[0]), said, shown, notes: hi.notes };

  // 5-7. A hook, a bar, and the check for a short.
  // Clear of the top 14%, where the apps draw their tabs: at y -0.3 its two lines reached into it, and the check said so.
  await call("add_text", { text: "How it started", start: 0, duration: 1.6, y: -0.2, style: { size: 90, stroke: { color: "#000000", width: 8 } } });
  await call("add_progress_bar", {});
  const check = await call("check_project", { kind: "social_short" });
  details.check = { ok: check.findings.length === 0, verdict: check.verdict, findings: check.findings.map((f) => `${f.level} ${f.rule}: ${f.message}`) };

  return { ok: Object.values(details).every((d) => d.ok), details };
};
