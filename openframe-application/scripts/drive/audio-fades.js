// Verify selected audio fade knobs clear the name/duration, including hover.
async (page) => {
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: "music-30s.mp3", src: `${location.origin}/fixtures/media/music-30s.mp3` }]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0 });
    ve.select(ve.project().tracks.flatMap((t) => t.clips.map((c) => c.id)));
    ve.action("zoomFit");
  });
  await page.locator(".fade-knob.out").waitFor();
  const bounds = () => page.evaluate(() => {
    const labelBottom = document.querySelector(".clip-audio .clip-label").getBoundingClientRect().bottom;
    const knobs = [...document.querySelectorAll(".fade-knob")].map((el) => el.getBoundingClientRect().top);
    return { ok: knobs.length === 2 && knobs.every((y) => y > labelBottom), labelBottom, knobTops: knobs };
  });
  const details = { rest: await bounds() };
  await page.locator(".fade-knob.in").hover();
  await page.waitForTimeout(350);
  details.hover = await bounds();
  await page.locator(".timeline-panel").screenshot({ path: "scratch/audio-fades.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
