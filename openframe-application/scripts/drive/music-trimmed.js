// analyze_music on trimmed and moved clips of one score, through MCP
// (ADR-096). A clip of the first 32 s of a 120 BPM score with drops at 8
// and 36 used to be read on its own: its downbeats came out on odd seconds
// and its drop at 7. The whole file is now read once (then kept) and its
// grid mapped through each clip's in-point and place, so every clip keeps
// the file's bar phase. Hints (bpm, first_downbeat, cues) replace what is
// detected, and confidence says how sure each reading is.
async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  page.setDefaultTimeout(180000);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const r = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args) => {
      const res = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (res.result.isError) throw new Error(`${name}: ${res.result.content[0].text}`);
      return JSON.parse(res.result.content[0].text);
    };
    // The launch promo's form: intro 0-4, build 4-8, drop 8, breakdown 32-36, drop 36, outro 48-56.
    const score = await call("generate_music", { style: "launch", bpm: 120, seed: 7, detail: "full", sections: [{ name: "intro", bars: 2 }, { name: "build", bars: 2 }, { name: "drop", bars: 12 }, { name: "breakdown", bars: 2 }, { name: "drop", bars: 6 }, { name: "outro", bars: 4 }] });
    const whole = await call("analyze_music", { clip_id: score.clip_id });
    // Source 0-32 from timeline 0, as the documentary cut it.
    await call("trim_clip", { clip_id: score.clip_id, edge: "end", to: 32 });
    const trimmed = await call("analyze_music", { clip_id: score.clip_id, detail: "full" });
    // Source 8-24 played again from timeline 40, on a track of its own.
    const track = (await call("add_track", { kind: "audio", name: "Music 2" })).tracks?.[0]?.id ?? ve.project().tracks.find((t) => t.name === "Music 2").id;
    await call("add_media_clip", { asset_id: score.asset_id, track_id: track, start: 40, in: 8, duration: 16 });
    const moved_id = ve.project().tracks.find((t) => t.id === track).clips[0].id;
    const moved = await call("analyze_music", { clip_id: moved_id });
    // Hints: a downbeat a beat pair later (odd seconds) and the parts by name.
    const hinted = await call("analyze_music", { clip_id: score.clip_id, bpm: 120, first_downbeat: 1 });
    const cued = await call("analyze_music", { clip_id: score.clip_id, cues: [{ at: 0, label: "intro" }, { at: 4, label: "build" }, { at: 8, label: "drop" }, { at: 32, label: "breakdown" }, { at: 36, label: "drop" }, { at: 48, label: "outro" }], markers: ["drop"] });
    const markers = ve.describe().markers.filter((m) => m.label === "Drop").map((m) => m.at);
    return { score: { bars: score.bars, drops: score.drops, sections: score.sections }, whole, trimmed, moved, hinted, cued, markers };
  });
  const onBar = (t, shift = 0) => r.score.bars.some((b) => Math.abs(b - (t - shift)) < 0.06);
  const near = (a, b, tol = 0.1) => Math.abs(a - b) <= tol;
  const sure = (c) => ["tempo", "bars", "sections"].every((k) => c[k] >= 0 && c[k] <= 1);
  const details = {
    // The cue sheet's own drops: 8 and 36.
    score: { ok: r.score.drops.length === 2 && near(r.score.drops[0], 8) && near(r.score.drops[1], 36), drops: r.score.drops },
    whole: { ok: r.whole.source.whole_file && !r.whole.source.cached && r.whole.drops.length === 2 && near(r.whole.drops[0], 8, 0.5) && near(r.whole.drops[1], 36, 0.5) && sure(r.whole.confidence), drops: r.whole.drops, confidence: r.whole.confidence },
    // The trimmed clip: the file's reading, kept, its drop at 8 and bars on even seconds.
    trimmed: { ok: r.trimmed.source.cached && r.trimmed.drops.length === 1 && near(r.trimmed.drop, 8, 0.5) && r.trimmed.downbeats.length >= 14 && r.trimmed.downbeats.every((t) => onBar(t)) && r.trimmed.beats.every((t) => t < 32), drop: r.trimmed.drop, downbeats: r.trimmed.downbeats },
    // Moved: source 8 at timeline 40, the bars where the file has them.
    moved: { ok: r.moved.source.clip_in === 8 && r.moved.downbeats.length >= 7 && r.moved.downbeats.every((t) => t >= 40 && t < 56 && onBar(t, 32)) && r.moved.sections[0].label === "drop", downbeats: r.moved.downbeats, sections: r.moved.sections },
    hinted: { ok: r.hinted.bpm === 120 && r.hinted.confidence.bars === 1 && r.hinted.downbeats.every((t) => near((t - 1) / 2, Math.round((t - 1) / 2), 0.01)) && r.hinted.given?.first_downbeat === 1, downbeats: r.hinted.downbeats.slice(0, 4) },
    cued: { ok: r.cued.sections.map((s) => s.label).join() === "intro,build,drop" && r.cued.drops.length === 1 && near(r.cued.drops[0], 8, 0.01) && r.markers.some((t) => near(t, 8, 0.05)), sections: r.cued.sections, markers: r.markers },
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
