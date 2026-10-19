// Regression checks for the launch film's seven UI and command fixes.
async (page) => {
  page.setDefaultTimeout(10000);
  await page.context().route("http://127.0.0.1:11434/**", route => route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: '{"models":[]}' }));
  // Stub only synthesis; retake placement, assets and response are real.
  await page.context().route("**/src/engine/tts.ts*", route => route.fulfill({ contentType: "application/javascript", body: `
    export async function speak() {
      const rate = 24000, audio = new Float32Array(rate);
      for (let i = 0; i < audio.length; i++) audio[i] = 0.2 * Math.sin(i * 2 * Math.PI * 220 / rate);
      return { audio, rate };
    }
  ` }));
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const modelCacheCount = await page.evaluate(async () => (await caches.keys()).length);
  const details = await page.evaluate(async () => {
    const v = window.videoEditor;
    const call = async (name, args) => {
      const r = await v.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(JSON.stringify(r));
      return JSON.parse(r.result.content[0].text);
    };
    const [asset] = await v.import([{ name: "speech-test.wav", src: `${location.origin}/fixtures/media/speech-test.wav` }]);
    const voice = (await call("add_media_clip", { asset_id: asset.id, start: 0 })).added_clips[0].id;
    const retake = await call("retake_voiceover", { clip_id: voice, text: "Every character in this sentence needs enough time to be spoken clearly", ripple: true });
    const explicit = await call("retake_voiceover", { clip_id: voice, speed: 1, ripple: true });
    const a = (await call("add_text", { text: "one STYLE end", start: 0, duration: 8 })).added_clips[0].id;
    const b = (await call("add_text", { text: "second", start: 10, duration: 8 })).added_clips[0].id;
    await call("style_text_range", { clip_id: a, start: 4, end: 9, color: "#ff0000" });
    await call("set_text", { clip_id: a, text: "one\nSTYLE\nend" });
    const clip = id => v.project().tracks.flatMap(t => t.clips).find(c => c.id === id);
    const equal = clip(a).style.runs[0];
    await call("set_text", { clip_ids: [a], text: "first STYLE ending" });
    const unequal = clip(a).style.runs[0];
    await call("set_text", { clip_ids: [a, b], style: { size: 90 } });
    const batch = await call("batch", { commands: [
      { command: "remove_keyframes", args: { clip_ids: [a, b], path: "opacity" } },
      { command: "set_text", args: { clip_id: b, style: { size: 100 } } },
    ] });
    const track = v.project().tracks.find(t => t.clips.some(c => c.id === a));
    const overwrite = await call("add_color_clip", { color: "#000000", start: 0, duration: 8, track_id: track.id });
    for (let i = 0; i < 12; i++) await call("add_track", { kind: "video", name: `Track ${i}` });
    await call("add_marker", { at: 1, label: "Pinned" });
    v.seek(60);
    return {
      runs: { ok: equal.start === 4 && equal.end === 9 && unequal.start === 6 && unequal.end === 11, equal, unequal },
      clip_ids: { ok: clip(b).style.size === 100 },
      noop: { ok: batch.notes?.length === 2, notes: batch.notes },
      overwrite: { ok: overwrite.overwritten?.some(c => c.id === a && c.what === "removed"), report: overwrite.overwritten },
      retake: { ok: retake.speed_chosen === true && /words a second/.test(retake.note) && !explicit.speed_chosen, speed: retake.speed, note: retake.note, synthesis: "mocked" },
    };
  });
  details.voiceModelAvailability = { ok: true, cacheCount: modelCacheCount, note: "Fresh isolated browser; no cached speech models. Real voiceover-directed omitted; retake synthesis mocked." };
  const bounds = () => page.evaluate(() => {
    const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
    return { ruler: box(".tl-ruler"), marker: box(".tl-marker"), head: box(".tl-playhead-cap"), scroll: document.querySelector(".tl-scroll").scrollTop };
  });
  const before = await bounds();
  await page.locator(".tl-scroll").evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(150);
  const after = await bounds();
  details.pinned = { ok: after.scroll > 0 && Math.abs(before.marker.top - after.marker.top) < 1 && Math.abs(before.head.top - after.head.top) < 1 && after.marker.top >= after.ruler.top && after.head.bottom <= after.ruler.bottom, before, after };
  await page.getByRole("tab", { name: "Audio", exact: true }).click();
  const card = page.getByRole("region", { name: "Generate music" });
  const tempo = card.getByLabel("Tempo"), length = card.getByLabel("Length (s)");
  await tempo.fill(""); await tempo.pressSequentially("120");
  const draft = await tempo.inputValue();
  await tempo.press("Enter");
  await length.fill(""); await length.pressSequentially("120"); await length.press("Enter");
  details.typing = { ok: draft === "120" && await tempo.inputValue() === "120" && await length.inputValue() === "120" };
  const view = () => page.evaluate(() => {
    const el = document.querySelector(".tl-scroll"), header = document.querySelector(".tl-corner").getBoundingClientRect().width;
    return { frames: (el.clientWidth - header) / window.videoEditor.state().zoom, left: el.scrollLeft / window.videoEditor.state().zoom };
  });
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.videoEditor.action("zoomIn"); });
  await page.waitForTimeout(100);
  await page.locator(".tl-scroll").evaluate(el => { el.scrollLeft = 200; });
  const oldView = await view();
  await page.locator(".assistant-btn").click();
  await page.waitForTimeout(500);
  const newView = await view();
  details.refit = { ok: oldView.left > 0 && Math.abs(oldView.frames - newView.frames) < 1 && Math.abs(oldView.left - newView.left) < 1, oldView, newView };
  return { ok: Object.values(details).every(d => d.ok), details };
}
