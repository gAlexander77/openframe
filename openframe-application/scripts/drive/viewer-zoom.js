// Viewer zoom drive: the transport's zoom menu (Fit, 25%..400% of the
// project's pixels), Ctrl+wheel zooming at the pointer (the picture point
// under it stays put), the wheel and a middle-button drag panning, the
// on-canvas handles following, and Fit putting it all back.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const api = window.videoEditor;
    const [img] = await api.import([{ name: "color-bars.png", src: location.origin + "/fixtures/media/color-bars.png" }]);
    api.exec("add_media_clip", { asset_id: img.id, start: 0, duration: 3 });
    api.select([api.describe().tracks.flatMap((t) => t.clips)[0].id]);
  });
  const frame = () => page.locator(".player-frame").boundingBox();
  const details = {};
  const fit = await frame();

  await page.getByRole("combobox", { name: "Viewer zoom" }).selectOption("100");
  const full = await frame();
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  details.hundred = { ok: Math.abs(full.width - 1920 / dpr) < 2, width: full.width };

  // Ctrl+wheel at a point: that point of the picture stays under it.
  const stage = await page.locator(".player-stage").boundingBox();
  const cx = stage.x + stage.width * 0.3, cy = stage.y + stage.height * 0.4;
  const before = await frame();
  const u = (cx - before.x) / before.width, v = (cy - before.y) / before.height;
  await page.mouse.move(cx, cy);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await page.waitForTimeout(100);
  const zoomed = await frame();
  const u2 = (cx - zoomed.x) / zoomed.width, v2 = (cy - zoomed.y) / zoomed.height;
  details.zoomAtPointer = { ok: zoomed.width > before.width * 1.1 && Math.abs(u2 - u) < 0.005 && Math.abs(v2 - v) < 0.005, u, u2, v, v2 };

  // The wheel pans; a middle drag pans.
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(80);
  const wheeled = await frame();
  details.wheelPans = { ok: Math.abs(wheeled.y - (zoomed.y - 120)) < 2 && Math.abs(wheeled.width - zoomed.width) < 1 };
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(cx + 80, cy + 30, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  const dragged = await frame();
  details.middleDragPans = { ok: Math.abs(dragged.x - (wheeled.x + 80)) < 2 && Math.abs(dragged.y - (wheeled.y + 30)) < 2 };

  // The handles stay on the picture.
  const tf = await page.locator(".tf-box").boundingBox();
  details.handlesFollow = { ok: !!tf && Math.abs(tf.x - dragged.x) < 2 && Math.abs(tf.width - dragged.width) < 2, tf, dragged };

  await page.getByRole("combobox", { name: "Viewer zoom" }).selectOption("fit");
  const back = await frame();
  details.fitRestores = { ok: Math.abs(back.x - fit.x) < 1 && Math.abs(back.width - fit.width) < 1 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
