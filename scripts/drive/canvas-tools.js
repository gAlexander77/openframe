// Canvas tools drive: the crop mode, mask handles and multi-selection
// handles on the viewer, each checked against the boxes it draws and the
// pixels the compositor renders (window.videoEditor.pixels()).
//   - Crop: the crop mode draws the whole picture, a handle drag edits a
//     copy, Enter applies it as one undo step, Escape leaves no trace, 1:1
//     crops the largest centered square, and on a rotated, mirrored
//     picture the kept part sits where the uncropped picture showed it.
//   - Masks: the outline matches the rendered shape; dragging moves it,
//     the knob turns it rigidly (a 90 degree turn on a wide picture keeps
//     its length), the arrow feathers it, the corner dot rounds it; heart
//     and star render inside their outline.
//   - Several pictures: one box around them, drag moves both with
//     snapping, a corner scales both about the center, one undo step; a
//     click on a grouped picture selects the group.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [bars] = await api.import([{ name: "color-bars.png", src: location.origin + "/fixtures/media/color-bars.png" }]);
    api.exec("add_media_clip", { asset_id: bars.id, start: 0, duration: 4 });
    api.exec("add_color_clip", { color: "#ff0000", start: 5, duration: 4 });
    api.exec("add_color_clip", { color: "#00ff00", start: 10, duration: 4 });
    api.exec("add_color_clip", { color: "#0000ff", start: 10, duration: 4 });
    const clips = api.project().tracks.flatMap((t) => t.clips);
    const pic = clips.find((c) => c.type === "image").id;
    const [red, green, blue] = ["#ff0000", "#00ff00", "#0000ff"].map((color) => clips.find((c) => c.color === color).id);
    api.exec("set_param", { clip_ids: [pic], path: "transform.scale", value: 0.5 });
    return { pic, red, green, blue };
  });

  const details = {};
  const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
  const clip = (id) => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id), id);
  const state = () => page.evaluate(() => window.videoEditor.state());
  const api = (fn, arg) => page.evaluate(fn, arg);
  // Project pixels to screen pixels, through the viewer's canvas.
  const canvas = () => page.locator(".player-canvas").boundingBox();
  const screen = async (x, y) => {
    const c = await canvas();
    return [c.x + (x * c.width) / 1920, c.y + (y * c.height) / 1080];
  };
  const rectOf = async (sel) => {
    const r = await page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().toJSON());
    const c = await canvas();
    const k = 1920 / c.width;
    return { left: (r.left - c.x) * k, top: (r.top - c.y) * k, right: (r.right - c.x) * k, bottom: (r.bottom - c.y) * k };
  };
  const rectNear = (r, want, tol = 6) => ["left", "top", "right", "bottom"].every((s) => near(r[s], want[s], tol));
  const sample = (pts) =>
    api(async (pts) => {
      const ve = window.videoEditor;
      await new Promise((r) => setTimeout(r, 80));
      await ve.rendered();
      const px = ve.pixels();
      const k = px.width / ve.project().width;
      return pts.map(([x, y]) => {
        const i = (Math.min(px.height - 1, Math.round(y * k)) * px.width + Math.min(px.width - 1, Math.round(x * k))) * 4;
        return [px.data[i], px.data[i + 1], px.data[i + 2]];
      });
    }, pts);
  const black = ([r, g, b]) => r + g + b < 45;
  const isColor = (want) => (p) => p.every((v, i) => Math.abs(v - want[i]) < 40);
  const drag = async (from, to, opts = {}) => {
    await page.mouse.move(from[0], from[1]);
    if (opts.ctrl) await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
    await page.mouse.move(to[0], to[1], { steps: 4 });
    const during = opts.during ? await opts.during() : undefined;
    await page.mouse.up();
    if (opts.ctrl) await page.keyboard.up("Control");
    return during;
  };
  const center = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const k = async () => (await canvas()).width / 1920;

  // ---- crop ----------------------------------------------------------------
  // The 960x540 picture spans x 480..1440, y 270..810. A quarter cropped
  // off its left keeps x 720..1440.
  await api((id) => {
    window.videoEditor.exec("set_crop", { clip_ids: [id], left: 0.25 });
    window.videoEditor.seek(30);
    window.videoEditor.select([id]);
  }, ids.pic);
  const cropButton = page.locator(".tl-toolbar").getByRole("button", { name: "Crop", exact: true });
  await cropButton.click();
  await page.locator(".crop-rect").waitFor();
  {
    const frame = await rectOf(".crop-frame"), rect = await rectOf(".crop-rect");
    // Bar 1 (yellow) at x 600 is cropped away, yet the crop mode shows it.
    const [whole] = await sample([[600, 400]]);
    details.cropShowsWhole = {
      ok: rectNear(frame, { left: 480, top: 270, right: 1440, bottom: 810 }) && rectNear(rect, { left: 720, top: 270, right: 1440, bottom: 810 }) && isColor([191, 191, 0])(whole),
      frame, rect, whole,
    };
    await page.screenshot({ path: "scratch/canvas-tools-crop.png" });
    const kk = await k();
    const from = await center(".crop-w");
    await drag(from, [from[0] + 240 * kk, from[1]]);
    const s = await state();
    details.cropDraftOnly = { ok: near(s.cropEdit.crop.left, 0.5, 0.01) && (await clip(ids.pic)).crop.left === 0.25, draft: s.cropEdit.crop, stored: (await clip(ids.pic)).crop };
    await page.keyboard.press("Enter");
    await page.locator(".crop-rect").waitFor({ state: "detached" });
    const c = await clip(ids.pic), after = await state();
    const [gone, kept] = await sample([[900, 400], [1000, 400]]);
    details.cropApply = { ok: near(c.crop.left, 0.5, 0.01) && after.undoLabel === "Crop" && !after.cropEdit && black(gone) && isColor([191, 0, 191])(kept), crop: c.crop, undo: after.undoLabel, gone, kept };
    await api(() => window.videoEditor.action("undo"));
    details.cropUndo = { ok: (await clip(ids.pic)).crop.left === 0.25 };
  }
  // Escape drops the copy and leaves no history.
  {
    const before = (await state()).undoLabel;
    await cropButton.click();
    await page.locator(".crop-rect").waitFor();
    const from = await center(".crop-e");
    await drag(from, [from[0] - 80, from[1]]);
    await page.keyboard.press("Escape");
    await page.locator(".crop-rect").waitFor({ state: "detached" });
    const s = await state();
    details.cropEscape = { ok: (await clip(ids.pic)).crop.right === 0 && s.undoLabel === before && s.selection[0] === ids.pic, undo: s.undoLabel };
  }
  // 1:1 crops the largest centered square: 540x540 at x 690..1230.
  {
    await cropButton.click();
    await page.getByRole("radio", { name: "1:1", exact: true }).click();
    const rect = await rectOf(".crop-rect");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const c = await clip(ids.pic);
    const px = await sample([[680, 400], [700, 400], [1220, 400], [1240, 400]]);
    details.cropRatio = {
      ok: rectNear(rect, { left: 690, top: 270, right: 1230, bottom: 810 }) && near(c.crop.left, 0.21875, 1e-6) && near(c.crop.right, 0.21875, 1e-6) && c.crop.top === 0 &&
        black(px[0]) && isColor([191, 191, 0])(px[1]) && isColor([0, 0, 191])(px[2]) && black(px[3]),
      rect, crop: c.crop, px,
    };
  }
  // Rotated a quarter turn and mirrored, with the source's right half
  // kept: the kept part is the top half of the turned picture (x 690..1230,
  // y 60..540), as the uncropped picture showed it.
  {
    await api((id) => {
      const ve = window.videoEditor;
      ve.exec("set_param", { clip_ids: [id], path: "transform.rotation", value: 90 });
      ve.exec("set_flip", { clip_ids: [id], horizontal: true });
      ve.exec("set_crop", { clip_ids: [id], left: 0.5, top: 0, right: 0, bottom: 0 });
    }, ids.pic);
    await page.waitForTimeout(100);
    const box = await rectOf(".tf-box");
    // (1100, 250) shows source x 1540 (bar 6, blue), y 260 (the 191 rows).
    const px = await sample([[1100, 250], [960, 800]]);
    details.cropFlipped = { ok: rectNear(box, { left: 690, top: 60, right: 1230, bottom: 540 }) && isColor([0, 0, 191])(px[0]) && black(px[1]), box, px };
    // The crop mode lines up with it, and its visual right edge (screen
    // bottom, after the turn) drags the source's left edge.
    await cropButton.click();
    await page.locator(".crop-rect").waitFor();
    const rect = await rectOf(".crop-rect");
    const kk = await k();
    const from = await center(".crop-e");
    await drag(from, [from[0], from[1] + 100 * kk]);
    await page.keyboard.press("Enter");
    const c = await clip(ids.pic);
    const [grown] = await sample([[1100, 600]]);
    details.cropFlippedDrag = { ok: rectNear(rect, box) && near(c.crop.left, 0.5 - 100 / 960, 0.01) && !black(grown), rect, crop: c.crop, grown };
    await page.screenshot({ path: "scratch/canvas-tools-crop-flipped.png" });
  }

  // ---- masks ---------------------------------------------------------------
  // A full-canvas red clip from 5 s.
  await api((id) => {
    window.videoEditor.seek(180);
    window.videoEditor.select([id]);
  }, ids.red);
  await page.getByRole("radio", { name: "Mask", exact: true }).click();
  await page.locator(".mask-shape.ms-rectangle").click();
  await page.locator(".mask-body").waitFor();
  {
    // 0.6 of 1920x1080, centered.
    const outline = await rectOf(".mask-outline path");
    const px = await sample([[960, 540], [1600, 540]]);
    details.maskOutline = { ok: rectNear(outline, { left: 384, top: 216, right: 1536, bottom: 864 }) && isColor([255, 0, 0])(px[0]) && black(px[1]), outline, px };
  }
  {
    const kk = await k();
    const from = await center(".mask-body");
    await drag(from, [from[0] + 100 * kk, from[1] + 50 * kk]);
    const m = (await clip(ids.red)).mask;
    details.maskMove = { ok: near(m.x, 100 / 1920, 0.003) && near(m.y, 50 / 1080, 0.004) && (await state()).undoLabel === "Move mask", mask: m };
  }
  {
    // Turn it a quarter: the knob from straight up to straight right.
    const c = await screen(960 + 100, 540 + 50);
    const from = await center(".mask-rotate");
    await drag(from, [c[0] + Math.hypot(from[0] - c[0], from[1] - c[1]), c[1] + 1]);
    const m = (await clip(ids.red)).mask;
    // Rigid: 1152 px long, now upright, 648 wide. Sheared, it would be
    // 648 tall and 1152 wide.
    const outline = await rectOf(".mask-outline path");
    const px = await sample([[1060, 1050], [1060 + 420, 590], [1060, 590]]);
    details.maskRotateRigid = {
      ok: m.rotation === 90 && rectNear(outline, { left: 1060 - 324, top: 590 - 576, right: 1060 + 324, bottom: 590 + 576 }) && isColor([255, 0, 0])(px[0]) && black(px[1]) && isColor([255, 0, 0])(px[2]),
      rotation: m.rotation, outline, px,
    };
    await page.screenshot({ path: "scratch/canvas-tools-mask.png" });
  }
  {
    // The arrow runs down the mask's own axis, which now points left.
    const kk = await k();
    const from = await center(".mask-feather");
    await drag(from, [from[0] - 108 * kk, from[1]]);
    const m = (await clip(ids.red)).mask;
    details.maskFeather = { ok: near(m.feather, 0.25, 0.015) && (await state()).undoLabel === "Feather mask", feather: m.feather };
  }
  {
    // A heart in a 648 px square, through the agents' command.
    await api((id) => window.videoEditor.exec("set_mask", { clip_ids: [id], shape: "heart", x: 0, y: 0, width: 0.3375, height: 0.6, rotation: 0, feather: 0 }), ids.red);
    await page.waitForTimeout(80);
    const outline = await rectOf(".mask-outline path");
    // center, the dip between the lobes, a lobe, a corner, near the tip
    const px = await sample([[960, 540], [960, 248], [1094, 248], [1260, 840], [960, 830]]);
    details.maskHeart = { ok: rectNear(outline, { left: 636, top: 216, right: 1284, bottom: 864 }) && [true, false, true, false, true].every((red, i) => (red ? isColor([255, 0, 0])(px[i]) : black(px[i]))), outline, px };
  }
  {
    await page.locator(".mask-shape.ms-star").click();
    await page.waitForTimeout(80);
    const outline = await rectOf(".mask-outline path");
    // center, between the two lower legs, the right arm, the top arm
    const px = await sample([[960, 540], [960, 783], [1187, 475], [960, 260]]);
    details.maskStar = { ok: (await clip(ids.red)).mask.shape === "star" && rectNear(outline, { left: 636, top: 216, right: 1284, bottom: 864 }) && [true, false, true, true].every((red, i) => (red ? isColor([255, 0, 0])(px[i]) : black(px[i]))), outline, px };
  }
  {
    // Round corners: the dot from the corner halfway to the middle.
    await page.locator(".mask-shape.ms-rectangle").click();
    const [before] = await sample([[656, 236]]);
    const kk = await k();
    const from = await center(".mask-radius");
    await drag(from, [from[0] + 162 * kk, from[1] + 162 * kk]);
    const m = (await clip(ids.red)).mask;
    const [after] = await sample([[656, 236]]);
    details.maskRound = { ok: near(m.radius, 0.5, 0.03) && isColor([255, 0, 0])(before) && black(after), radius: m.radius, before, after };
  }

  // ---- several pictures ----------------------------------------------------
  // Green and blue 384x216 boxes centered at (480, 540) and (1152, 756).
  await page.getByRole("radio", { name: "Basic", exact: true }).click();
  await api((ids) => {
    const ve = window.videoEditor;
    for (const id of [ids.green, ids.blue]) ve.exec("set_param", { clip_ids: [id], path: "transform.scale", value: 0.2 });
    ve.exec("set_param", { clip_ids: [ids.green], path: "transform.x", value: -0.25 });
    ve.exec("set_param", { clip_ids: [ids.blue], path: "transform.x", value: 0.1 });
    ve.exec("set_param", { clip_ids: [ids.blue], path: "transform.y", value: 0.2 });
    ve.seek(330);
    ve.select([ids.green, ids.blue]);
  }, ids);
  await page.locator(".tf-group").waitFor();
  const tx = async () => ({ g: (await clip(ids.green)).transform, b: (await clip(ids.blue)).transform });
  {
    const box = await rectOf(".tf-group");
    const members = await page.locator(".tf-member").count();
    details.groupBox = { ok: rectNear(box, { left: 288, top: 432, right: 1344, bottom: 864 }) && members === 2, box, members };
    await page.screenshot({ path: "scratch/canvas-tools-group.png" });
  }
  {
    // Ctrl drags freely: both move 100 px.
    const kk = await k();
    const from = await center(".tf-group");
    await drag(from, [from[0] + 100 * kk, from[1]], { ctrl: true });
    const t = await tx();
    details.groupMove = { ok: near(t.g.x, -0.25 + 100 / 1920, 0.003) && near(t.b.x, 0.1 + 100 / 1920, 0.003) && t.b.y === 0.2 && (await state()).undoLabel === "Move", t };
    await api(() => window.videoEditor.action("undo"));
    const u = await tx();
    details.groupMoveUndo = { ok: u.g.x === -0.25 && u.b.x === 0.1 };
  }
  {
    // Snaps the box's center to the canvas center from 3 screen px away.
    const c = await canvas();
    const from = await center(".tf-group");
    const guide = await drag(from, [c.x + c.width / 2 + 3, from[1]], { during: () => page.locator(".tf-guide-v").count() });
    const t = await tx();
    details.groupSnap = { ok: guide === 1 && near(t.g.x, -0.175, 1e-6) && near(t.b.x, 0.175, 1e-6), guide, t };
  }
  {
    // A corner pulled to twice its distance from the center doubles both,
    // and their positions spread from the center with them.
    const box0 = await rectOf(".tf-group");
    const cx = (box0.left + box0.right) / 2, cy = (box0.top + box0.bottom) / 2;
    const se = await center(".tf-group .tf-se");
    const c = await screen(cx, cy);
    await drag(se, [c[0] + 2 * (se[0] - c[0]), c[1] + 2 * (se[1] - c[1])]);
    const t = await tx();
    const box = await rectOf(".tf-group");
    // Green's center was 336 px left of the box center, blue's 336 right.
    const gx = cx + 2 * (480 + 0.075 * 1920 - cx), bx = cx + 2 * (1152 + 0.075 * 1920 - cx);
    const px = await sample([[gx, cy + 2 * (540 - cy)], [bx, cy + 2 * (756 - cy)]]);
    details.groupScale = {
      ok: near(t.g.scale, 0.4, 0.01) && near(t.b.scale, 0.4, 0.01) && near(box.right - box.left, 2 * (box0.right - box0.left), 8) && near((box.left + box.right) / 2, cx, 4) &&
        isColor([0, 255, 0])(px[0]) && isColor([0, 0, 255])(px[1]) && (await state()).undoLabel === "Scale",
      t, box, px,
    };
    await api(() => window.videoEditor.action("undo"));
    const u = await tx();
    details.groupScaleUndo = { ok: u.g.scale === 0.2 && u.b.scale === 0.2 && near(u.g.x, -0.175, 1e-6) };
  }
  {
    // A click on a grouped picture in the viewer selects its group; Alt one.
    await api((ids) => {
      window.videoEditor.exec("group_clips", { clip_ids: [ids.green, ids.blue] });
      window.videoEditor.select([]);
    }, ids);
    // Click the blue picture itself, not empty canvas above it.
    const blue = await clip(ids.blue);
    const at = await screen(960 + blue.transform.x * 1920, 540 + blue.transform.y * 1080);
    await page.mouse.click(at[0], at[1]);
    const both = (await state()).selection.length;
    await page.keyboard.press("Escape");
    await page.keyboard.down("Alt");
    await page.mouse.click(at[0], at[1]);
    await page.keyboard.up("Alt");
    const one = (await state()).selection.length;
    details.groupClick = { ok: both === 2 && one === 1, both, one };
  }
  return { ok: Object.values(details).every((d) => d.ok), details };
};
