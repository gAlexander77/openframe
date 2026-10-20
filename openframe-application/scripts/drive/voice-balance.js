// Voice over music in named windows, through MCP (ADR-096). "11 LU over
// the music" meant three things in three answers; each now names its
// window: program (the whole stretch, music between lines in), speech
// (while the voice speaks, its lines together) and line (each alone).
// Three narrated lines over the standard music fixture, the middle one
// turned 6 dB down: voice_above_music_lu meets its target over the speech
// window while that line sits under it; min_line_lu then holds every line
// to the minimum, the quiet line dipping deeper; measure_loudness by_track
// answers summaries unless per_second is asked, and judges the loudness
// range for its kind.
async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  page.setDefaultTimeout(600000);
  await page.locator(".create-card").click();
  const call = async (name, args = {}) => {
    const r = await page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
    if (r.result?.isError || r.error) throw new Error(name + ": " + JSON.stringify(r));
    return JSON.parse(r.result.content[0].text);
  };
  const music = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: "music-30s.mp3", src: "http://localhost:1420/fixtures/media/music-30s.mp3" }]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0 });
    return ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.type === "audio").id;
  });
  const vo = await call("add_voiceover", {
    captions: false,
    lines: [
      { text: "Build your next story with clear words and music.", at: 1 },
      { text: "Every cut brings your ideas to life.", at: 10 },
      { text: "The voice stays clear over the score.", at: 19 },
    ],
  });
  const quiet = vo.lines[1].voice_clip;
  await call("set_param", { clip_ids: [quiet], path: "volume", value: 0.5 });
  const before = await call("measure_loudness", { start: 0, end: 30, by_track: true });
  const toSpeech = await call("duck_under_speech", { clip_id: music, voice_above_music_lu: 12 });
  const report = await call("measure_loudness", { start: 0, end: 30, by_track: true, per_second: true, kind: "film" });
  await call("undo");
  const perLine = await call("duck_under_speech", { clip_id: music, min_line_lu: 12 });
  const review = await call("review_voiceover", { recheck: false });
  const each = perLine.balance?.per_line?.each ?? [];
  const quietLine = each.find((l) => Math.abs(l.start - vo.lines[1].start) < 0.5);
  const details = {
    // Summaries by default: no per-second arrays; three named windows.
    summaries: { ok: before.by_track.length >= 2 && before.by_track.every((t) => Number.isFinite(t.integrated_lufs) && t.loudness_range_lu !== undefined && !t.short_term) && before.balance.program.window === "program" && before.balance.speech.window === "speech" && before.balance.per_line.lines === 3, balance: before.balance },
    // The speech window's target met, while the quiet line sits under it: the windows differ.
    speechTarget: { ok: toSpeech.balance.window === "speech" && toSpeech.balance.met === true && Math.abs(toSpeech.balance.voice_above_music_lu - 12) <= 0.5 && toSpeech.balance.per_line.min_lu < 11, balance: toSpeech.balance },
    // per_second asked: the arrays; the range judged for a film.
    perSecond: { ok: report.by_track.every((t) => Array.isArray(t.short_term) && t.short_term.length > 0) && report.range.kind === "film" && typeof report.range.verdict === "string" && Math.abs(report.balance.speech.voice_above_music_lu - toSpeech.balance.voice_above_music_lu) <= 0.6, range: report.range, loudness_range_lu: report.loudness_range_lu, speech: report.balance.speech },
    // Every line at least 12 LU over the music, the quiet one dipping deeper.
    perLine: { ok: perLine.balance.per_line.met === true && each.length === 3 && each.every((l) => l.voice_above_music_lu >= 11.95) && !!quietLine && quietLine.depth_db >= Math.max(...each.filter((l) => l !== quietLine).map((l) => l.depth_db)) + 3, each },
    // review_voiceover's per-line margins agree (its window: the line's own speech).
    review: { ok: review.summary.voice_above_music?.window === "line" && review.lines.every((l) => l.voice_above_music_lu >= 11.4), margins: review.lines.map((l) => l.voice_above_music_lu), summary: review.summary.voice_above_music },
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
