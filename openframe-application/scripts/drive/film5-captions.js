// Real Whisper plus the exact overlapping boundary from film 5, and
// whole-line readability checked by the same rule as check_project.
async (page) => {
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.result.isError) throw Error(r.result.content[0].text);
      return JSON.parse(r.result.content.find(c => c.type === "text").text);
    };
    const [a] = await ve.import([{ src: location.origin + "/fixtures/media/speech-test.wav" }]);
    if (!a.id) throw Error(JSON.stringify(a));
    ve.exec("add_media_clip", { asset_id: a.id, start: 0 });
    const track = ve.project().tracks.find(t => t.clips.some(c => c.assetId === a.id)), clip = track.clips[0];
    ve.exec("update_track", { track_id: track.id, role: "dialog" });
    const transcript = await call("get_transcript", { clip_id: clip.id });
    const monotonic = transcript.words.length > 10 && transcript.words.every((w, i, all) => w.end > w.start && (!i || w.start >= all[i - 1].end));
    const caps = await call("auto_captions", { replace: true, track_ids: [track.id], look: "boxed", detail: "full" });
    const check = await call("check_project", {});
    const made = new Set(ve.project().tracks.flatMap(t => t.clips).filter(c => c.caption).map(c => c.id));
    const failures = check.findings.filter(f => f.rule === "caption_too_fast" && made.has(f.clip_id));
    const { monotonicWords, readableCaptions, captionReading } = await import("/src/lib/captions.ts");
    const boundary = monotonicWords([{ text: "planet.", start: 27.5, end: 28 }, { text: "planet", start: 27.77, end: 28.55 }, { text: "Next", start: 28.4, end: 29 }]);
    let at = 0;
    const words = "on how to rappel and ascend in and out of a cave shaft. And CAVES is one of those tools that will help you prepare to go to the Moon, do research exploration stay on the Moon and have a permanent presence there.".split(" ").map(text => { const start = at; at += 0.29; return { text, start, end: at - 0.01 }; });
    const grouped = readableCaptions(words);
    return {
      transcript: { ok: monotonic, words: transcript.words },
      automatic: { ok: caps.count > 0 && caps.readability.met === true && failures.length === 0, captions: caps, failures },
      boundary: { ok: boundary.length === 2 && boundary[1].start >= boundary[0].end, words: boundary },
      grouping: { ok: grouped.every(c => captionReading(c).met && c.text.split("\n").length <= 2) && !grouped.some(c => c.text === "shaft."), captions: grouped },
    };
  });
  return { ok: Object.values(details).every(x => x.ok), details };
}
