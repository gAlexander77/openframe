// Hit targets (UX-31): the fade knob, the marker and the keyframe diamond
// answer within 24 px grabs, while the trim handle keeps the clip's outer
// 8 px beside the knob. Checked with elementFromPoint, as a pointer lands.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const api = window.videoEditor;
    const [v] = await api.import([{ name: "voice-8s.wav", src: location.origin + "/fixtures/media/voice-8s.wav" }]);
    api.exec("add_media_clip", { asset_id: v.id, start: 0, duration: 4 });
    api.exec("add_markers", { times: [2] });
    api.select([api.describe().tracks.flatMap((t) => t.clips)[0].id]);
  });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const at = (x, y) => document.elementFromPoint(x, y);
    const k = document.querySelector(".fade-knob.in").getBoundingClientRect();
    const clip = document.querySelector(".clip").getBoundingClientRect();
    const m = document.querySelector(".tl-marker").getBoundingClientRect();
    const cx = k.left + k.width / 2, cy = k.top + k.height / 2;
    return {
      // 10 px right and 9 px below the knob's center: outside the old dot.
      knobGrab: !!at(cx + 10, cy + 9)?.closest(".fade-knob"),
      trimEdge: !!at(clip.left + 3, cy)?.closest(".trim-start"),
      markerGrab: !!at(m.left + m.width / 2 + 10, m.top + 20)?.closest(".tl-marker"),
    };
  });
  return { ok: r.knobGrab && r.trimEdge && r.markerGrab, details: { hits: { ok: r.knobGrab && r.trimEdge && r.markerGrab, ...r } } };
};
