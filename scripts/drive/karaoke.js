// Spoken-word highlight drive: captions added with word times (as auto
// captions add them) and the highlight on draw the word being spoken in
// the highlight color and the rest in the text color; the lit word moves
// as the playhead does; off, nothing is lit. Pure red text, pure green
// highlight, so the colors can be counted in the rendered frame.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(() => {
    const api = window.videoEditor;
    api.exec("add_color_clip", { color: "#000000", start: 0, duration: 4 });
    api.exec("add_captions", { captions: [{ start: 0, end: 3, text: "one two three", words: [0, 1, 2] }], style: { color: "#ff0000", size: 120 }, y: 0 });
    const c = api.describe().tracks.flatMap((t) => t.clips).find((x) => x.type === "text");
    api.exec("set_text", { clip_id: c.id, style: { color: "#ff0000" } });
    return c.id;
  });
  // Turn the highlight on through the inspector, as a person would.
  await page.evaluate((id) => window.videoEditor.select([id]), id);
  await page.getByRole("switch", { name: "Highlight the spoken word" }).click();
  await page.evaluate((id) => {
    window.videoEditor.exec("set_text", { clip_id: id, style: { highlight: "#00ff00" } });
    window.videoEditor.select([]);
  }, id);
  /** Mean x (0..1) of green and of red pixels in the frame at `f`. */
  const colors = (f) =>
    page.evaluate(async (f) => {
      const api = window.videoEditor;
      api.seek(f);
      await new Promise((r) => setTimeout(r, 40));
      await api.rendered();
      const px = api.pixels(640);
      let g = 0, gx = 0, r = 0, rx = 0;
      for (let i = 0; i < px.data.length; i += 4) {
        const x = ((i / 4) % px.width) / px.width;
        const [R, G, B] = [px.data[i], px.data[i + 1], px.data[i + 2]];
        if (G > 180 && R < 90 && B < 90) (g++, (gx += x));
        else if (R > 180 && G < 90 && B < 90) (r++, (rx += x));
      }
      return { green: g, red: r, gx: g ? +(gx / g).toFixed(3) : null };
    }, f);
  const details = {};
  const first = await colors(10), second = await colors(40), third = await colors(75);
  details.lit = { ok: first.green > 50 && first.red > first.green && second.green > 50 && third.green > 50, first, second, third };
  details.moves = { ok: first.gx < second.gx && second.gx < third.gx, xs: [first.gx, second.gx, third.gx] };
  await page.evaluate((id) => window.videoEditor.exec("set_text", { clip_id: id, style: { highlight: "" } }), id);
  const off = await colors(40);
  details.off = { ok: off.green === 0 && off.red > 100, off };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
