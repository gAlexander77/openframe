// Captions of a voice with a known script follow the script (ADR-092).
// add_voiceover reads two lines with no captions; their takes are made to
// say other words than their scripts ("stool" for "tool", "helm" for
// "home"), as a recognizer mishearing a word would show it. Then the
// Captions tab's Generate captions: the voice lines are captioned in their
// scripts' words at Whisper's times. get_transcript on a
// voice line answers its script's words too, while a recording with no
// script (speech-test.wav) keeps the words Whisper heard. (Hearing the
// whole timeline, Whisper base dropped the recording after the voice
// lines: its own word list ended at "helmed.", so get_transcript checks it.)
async (page) => {
  page.setDefaultTimeout(900000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const call = async (name, args = {}) => {
    const r = await page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
    if (r.error || r.result?.isError) throw new Error(`${name}: ${r.error?.message ?? r.result.content[0].text}`);
    return JSON.parse(r.result.content[0].text);
  };
  const details = {};
  const origin = await page.evaluate(() => location.origin);
  const vo = await call("add_voiceover", { lines: [{ text: "Every edit in this editor is a stool." }, { text: "Bring all of it, helm." }], captions: false, quality: "draft" });
  const [a, b] = vo.lines;
  await page.evaluate(async (ids) => {
    const loaded = performance.getEntriesByType("resource").map((e) => e.name);
    const { store } = await import(loaded.find((n) => new URL(n).pathname === "/src/state/store.ts"));
    const meant = { [ids[0]]: "Every edit in this editor is a tool.", [ids[1]]: "Bring all of it, home." };
    store.edit("Scripts", (p) => {
      const asset = (id) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id).assetId;
      const by = Object.fromEntries(Object.entries(meant).map(([id, text]) => [asset(id), text]));
      return { ...p, assets: p.assets.map((x) => (by[x.id] ? { ...x, speech: { ...x.speech, text: by[x.id] } } : x)) };
    });
  }, [a.voice_clip, b.voice_clip]);
  // A recording with no script, after the voice.
  const [rec] = await call("import_media", { files: [{ src: `${origin}/fixtures/media/speech-test.wav` }] });
  const recAt = Math.ceil(b.end + 1);
  await call("add_media_clip", { asset_id: rec.id, start: recAt });

  await page.getByRole("tab", { name: "Captions" }).click();
  await page.getByRole("button", { name: "Generate captions" }).click();
  await page.waitForFunction(() => window.videoEditor.project().tracks.some((t) => t.clips.some((c) => c.caption)), null, { timeout: 900000 });
  const caps = await page.evaluate(() => {
    const p = window.videoEditor.project();
    const fps = p.fps.num / p.fps.den;
    return p.tracks.flatMap((t) => t.clips).filter((c) => c.caption).sort((x, y) => x.start - y.start).map((c) => ({ text: c.text, start: +(c.start / fps).toFixed(2), end: +((c.start + c.duration) / fps).toFixed(2) }));
  });
  const voiced = caps.filter((c) => c.start < b.end + 0.2).map((c) => c.text).join(" ");
  details.scriptWords = { ok: /\btool\b/.test(voiced) && /\bhome\b/.test(voiced) && !/stool|helm/i.test(voiced), voiced };
  details.timed = { ok: caps.filter((c) => c.start < b.end + 0.2).every((c, i, l) => c.end > c.start && (i === 0 || c.start >= l[i - 1].end - 0.01) && c.start >= a.start - 0.3 && c.end <= b.end + 0.5), caps };
  const t = await call("get_transcript", { clip_id: a.voice_clip });
  const said = t.words.map((w) => w.text.trim()).join(" ");
  details.transcript = { ok: /\btool\.?$/.test(said) && !/stool/i.test(said), said };
  // A recording with no script keeps what Whisper heard.
  const recClip = await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.assetId === id).id, rec.id);
  const heard = (await call("get_transcript", { clip_id: recClip })).words.map((w) => w.text.trim()).join(" ");
  details.otherSpeech = { ok: /welcome to the video editor/i.test(heard), heard };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
