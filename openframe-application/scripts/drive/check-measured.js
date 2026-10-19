// check_project measures what it judges (ADR-097), over window.videoEditor.mcp
// as an agent calls it: every title's contrast on the rendered picture at a
// few moments of its life, its box, shadow and outline counted (Codex's
// soft-shadowed subtitle over a bright sky measured low and named with the
// fixes that measure better there; a boxed and an outlined copy pass; a
// title over a shot that turns bright is caught at the bright moment);
// text too small for a phone named by its share of the frame's height;
// music that fades out in its own audio over a second passes; the cuts of
// an interview with cutaways counted across tracks; and `ok` beside a
// warning said in words. The picture behind the titles is saved to
// scratch/check-measured.png for a look.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const rpc = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const call = async (name, args = {}) => {
    const r = await rpc(name, args);
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    return r.result.content;
  };
  const text = async (name, args) => JSON.parse((await call(name, args))[0].text);
  const { writeFileSync } = await import("node:fs");
  const origin = await page.evaluate(() => location.origin);
  const details = {};

  await text("new_project", { name: "Measured check" });
  // Music that fades out over its last second in its own audio (a linear
  // fade, which the old quarter-second rule called abrupt): 8 s of tone.
  {
    const rate = 22050, n = rate * 8, b = Buffer.alloc(44 + n * 2);
    b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) {
      const t = i / rate, g = t < 7 ? 0.5 : 0.5 * Math.max(0, 8 - t);
      b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * t) * g * 32767), 44 + i * 2);
    }
    writeFileSync("__REPO__/scratch/linear-fade.wav", b);
  }
  const [fade] = await text("import_media", { files: [{ src: `${origin}/scratch/linear-fade.wav`, name: "linear-fade.wav" }] });
  const main = (await text("describe_project")).tracks.find((t) => t.main).id;

  // A dark ground that turns to a bright sky at 4 s, and Codex's subtitle
  // look (size 40, pale blue, a soft shadow) over it, with a boxed and an
  // outlined copy; a big plain title across the turn.
  const subtitle = { size: 40, weight: 500, color: "#BBD9DC", shadow: { color: "#000000cc", blur: 16, x: 0, y: 0 } };
  await text("batch", {
    commands: [
      { command: "add_color_clip", args: { color: "#0b1020", start: 0, duration: 4, track_id: main } },
      { command: "add_color_clip", args: { color: "#f0e6d2", start: 4, duration: 4, track_id: main } },
      { command: "add_text", args: { text: "A WAY HOME", start: 4.5, duration: 3, y: 0.36, style: subtitle } },
      { command: "add_text", args: { text: "BOXED", start: 4.5, duration: 3, y: -0.3, style: { ...subtitle, size: 60, background: { color: "#000000a6", padding: 14, radius: 6 } } } },
      { command: "add_text", args: { text: "OUTLINED", start: 4.5, duration: 3, y: 0, style: { size: 60, color: "#ffffff", stroke: { color: "#000000", width: 3 } } } },
      { command: "add_text", args: { text: "Across the turn", start: 1, duration: 6, y: -0.15, style: { size: 120, color: "#ffffff" } } },
      { command: "add_media_clip", args: { asset_id: fade.id, start: 0, duration: 8 } },
    ],
  });
  const clips = (await text("describe_project")).tracks.flatMap((t) => t.clips);
  const id = (words) => clips.find((c) => c.text === words).id;
  const check = await text("check_project", {});
  const find = (rule, cid) => check.findings.find((f) => f.rule === rule && (!cid || f.clip_id === cid));
  const low = find("text_low_contrast", id("A WAY HOME"));
  const ratio = (cid) => check.contrast?.lowest?.find((x) => x.clip_id === cid)?.ratio;
  details.softShadowLow = {
    ok: low?.level === "warning" && /measures [\d.]+:1 against the picture behind it at [\d.]+ s \(backdrop #[0-9a-f]{6}, with its shadow\)/.test(low.message) && /style\.(background|stroke) .*\(measures [\d.]+:1 there\)/.test(low.fix) && low.at >= 4.5,
    message: low?.message,
    fix: low?.fix,
  };
  // The fixes it names measure well on the same pixels.
  const named = [...(low?.fix ?? "").matchAll(/measures ([\d.]+):1 there/g)].map((m) => +m[1]);
  details.fixesMeasured = { ok: named.length === 2 && named.every((r) => r >= 4.5), named };
  details.boxedAndOutlinedPass = { ok: !find("text_low_contrast", id("BOXED")) && !find("text_low_contrast", id("OUTLINED")) && ratio(id("BOXED")) >= 4.5 && ratio(id("OUTLINED")) >= 7, boxed: ratio(id("BOXED")), outlined: ratio(id("OUTLINED")) };
  // White over the dark ground reads; the same title after the turn does not:
  // measured across its life, it is named at a bright moment.
  const across = find("text_low_contrast", id("Across the turn"));
  details.acrossTheTurn = { ok: !!across && across.at >= 4, at: across?.at, message: across?.message };
  details.everyTitleMeasured = { ok: check.contrast?.lowest?.length === 4 && /4 titles at \d+ moments/.test(check.contrast.measured) && !/Contrast/.test(check.not_checked), contrast: check.contrast, not_checked: check.not_checked };
  const small = find("text_too_small", id("A WAY HOME"));
  details.tooSmall = { ok: /3\.7% of the frame's height \(size 40\)/.test(small?.message ?? "") && /size 49 or more/.test(small?.fix ?? ""), message: small?.message, fix: small?.fix };
  details.linearFadeEnds = { ok: !find("music_ends_abruptly"), rules: check.findings.map((f) => f.rule) };
  details.okInWords = { ok: check.ok === true && check.summary.warnings > 0 && /^ok means no errors; \d+ warnings? still to fix/.test(check.verdict), verdict: check.verdict };

  // The picture the titles were measured against (titles off), for a look.
  const frames = await call("preview_frames", { times: [2, 5, 6.5], tile_width: 480, columns: 3 });
  writeFileSync("__REPO__/scratch/check-measured.png", Buffer.from(frames[0].data, "base64"));

  // ---- shots across tracks: an interview with two cutaways ----------------------------
  await text("new_project", { name: "Cutaways" });
  const [v2] = await text("import_media", { files: [{ src: `${origin}/fixtures/media/h264-1080p30.mp4` }] });
  const d = await text("describe_project");
  const m2 = d.tracks.find((t) => t.main).id;
  await text("add_media_clip", { asset_id: v2.id, start: 0, duration: 9, track_id: m2 });
  const broll = (await text("add_track", { kind: "video", name: "B-roll" })).added_tracks?.[0]?.id ?? (await text("describe_project")).tracks.find((t) => t.name === "B-roll").id;
  for (const s of [2, 6]) await text("add_media_clip", { asset_id: v2.id, start: s, duration: 1.5, in: s + 1, track_id: broll });
  const shots = await text("check_project", {});
  details.shotsAcrossTracks = { ok: shots.summary.shots === 5 && /across tracks/.test(shots.summary.shots_on ?? ""), summary: shots.summary };

  return { ok: Object.values(details).every((x) => x.ok), details };
};
