// Keyframe editing drive: builds a moving color clip, then edits its
// keyframes the way a person would (the keyframe panel's graph and lanes,
// the timeline's diamonds, the inspector) and checks each edit three ways:
// the document, paramAt, and the viewer's pixels. Every edit must undo.
//
// Needs the dev server. Run through any Playwright page (playwright-core
// with the system Edge, or the MCP tool's `filename`); it reuses the
// page's origin when it is already on localhost, else opens :1420.
// Returns { ok, details }: ok is true when every check passed; details
// lists each check with what it saw. Screenshots go to scripts/drive/shots/.
async (page) => {
  const origin = /^http:\/\/localhost:\d+/.exec(page.url())?.[0] ?? "http://localhost:1420";
  await page.goto(origin);
  await page.waitForFunction(() => !!window.videoEditor);
  if (await page.locator(".create-card").isVisible()) await page.click(".create-card");
  await page.waitForSelector(".timeline-panel");

  const details = [];
  const check = (name, pass, seen) => details.push({ name, pass: !!pass, seen });
  const ve = (fn, arg) => page.evaluate(fn, arg);
  const settle = () => page.waitForTimeout(80);
  const shot = (n) => page.screenshot({ path: `scripts/drive/shots/keyframes-${n}.png` }).catch(() => {});
  const keysOf = (path) => ve(([id, p]) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id)?.keyframes?.[p] ?? null, [clipId, path]);
  const allKeys = () => ve((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id)?.keyframes ?? null, clipId);
  const center = async (loc) => {
    const b = await loc.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const drag = async (from, to, opts = {}) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    if (opts.shift) await page.keyboard.down("Shift");
    await page.mouse.move(to.x, to.y, { steps: 8 });
    if (opts.shift) await page.keyboard.up("Shift");
    await page.mouse.up();
    await settle();
  };
  /** Where the red layer's center is, as a fraction of the viewer width, on the middle row. */
  const redCenter = (frame) =>
    ve(async (f) => {
      const v = window.videoEditor;
      v.seek(f);
      await new Promise((r) => setTimeout(r, 30));
      await v.rendered();
      const { width: w, height: h, data } = v.pixels();
      const row = Math.floor(h / 2) * w * 4;
      let sum = 0;
      let n = 0;
      for (let x = 0; x < w; x++) {
        const i = row + x * 4;
        if (data[i] > 150 && data[i + 1] < 110 && data[i + 2] < 110) {
          sum += x;
          n++;
        }
      }
      return n ? (sum / n + 0.5) / w : null;
    }, frame);
  const xAt = (frame) => ve(([id, f]) => window.videoEditor.paramAt(id, "transform.x", f), [clipId, frame]);
  /** The layer's center must sit where transform.x says (0 = canvas center). */
  const pixelsMatch = async (name, frame) => {
    const x = await xAt(frame);
    const seen = await redCenter(frame);
    check(name, seen !== null && Math.abs(seen - (0.5 + x)) < 0.01, { frame, paramAt: +x.toFixed(4), pixelCenter: seen && +seen.toFixed(4), expected: +(0.5 + x).toFixed(4) });
    return x;
  };

  // ---- setup: a red box 0.3 of the canvas, moving left to right ------------------
  const clipId = await ve(() => {
    const v = window.videoEditor;
    v.exec("set_project", { background: "#000000" });
    v.exec("add_color_clip", { color: "#ff2020", start: 0, duration: 4 });
    const c = v.describe().tracks.flatMap((t) => t.clips).find((x) => x.type === "color");
    v.exec("set_param", { clip_ids: [c.id], path: "transform.scale", value: 0.3 });
    v.exec("add_keyframe", { clip_id: c.id, path: "transform.x", at: 0.5, value: -0.3 });
    v.exec("add_keyframe", { clip_id: c.id, path: "transform.x", at: 2.5, value: 0.3 });
    v.select([c.id]);
    v.action("zoomFit");
    v.seek(45);
    return c.id;
  });
  const original = await allKeys();
  const fps = await ve(() => window.videoEditor.project().fps.num / window.videoEditor.project().fps.den);
  check("setup at 30 fps with keys on frames 15 and 75", fps === 30 && original["transform.x"].map((k) => k.f).join() === "15,75", original);

  // ---- the panel opens from the keymap's chord ---------------------------------------
  await ve((id) => window.videoEditor.select([id]), clipId);
  await page.keyboard.press("Alt+K");
  await settle();
  check("Alt+K opens the keyframe panel", (await page.locator(".kf-panel").isVisible()) && (await ve(() => window.videoEditor.state().keyframePanel)), null);
  check("one lane per animated parameter", (await page.locator(".kf-lane-label").allTextContents()).join("|") === "Position X", await page.locator(".kf-lane-label").allTextContents());
  await shot("1-panel");

  // ---- linear: the box is centered halfway ------------------------------------------
  const x45 = await pixelsMatch("linear: pixels follow paramAt at the mid frame", 45);
  check("linear: paramAt is 0 halfway", Math.abs(x45) < 1e-9, x45);

  // ---- right-click a key in the graph and pick Ease in --------------------------------
  const graphKey = (f) => page.locator(`.kf-area [data-key="transform.x@${f}"]`).last();
  await graphKey(15).click({ button: "right" });
  await settle();
  check("right-click opens the easing menu", await page.locator(".ease-menu").isVisible(), null);
  await shot("2-ease-menu");
  await page.locator(".ease-item", { has: page.locator(".menu-label", { hasText: /^Ease in$/ }) }).click();
  await settle();
  const eased = await keysOf("transform.x");
  check("Ease in stored on the key", eased[0].ease === "easeIn", eased[0]);
  const xEase = await pixelsMatch("ease in: pixels follow paramAt", 45);
  check("ease in: slower start puts the box left of center", xEase < -0.08, xEase);

  // ---- drag the second key in the graph: earlier and higher ---------------------------
  await graphKey(75).click();
  await settle();
  const zoom = await ve(() => window.videoEditor.state().zoom);
  const k75 = await center(graphKey(75));
  await drag(k75, { x: k75.x - 10 * zoom, y: k75.y - 25 });
  const afterDrag = await keysOf("transform.x");
  check("graph drag retimes the key by 10 frames", afterDrag[1].f === 65, afterDrag);
  check("graph drag raises the value", afterDrag[1].v > 0.3 + 0.01, afterDrag[1].v);
  await pixelsMatch("after graph drag: pixels follow paramAt", 45);
  await shot("3-graph-drag");

  // ---- Shift locks the drag to one axis -------------------------------------------------
  const k65 = await center(graphKey(65));
  const before = await keysOf("transform.x");
  await drag(k65, { x: k65.x + 3, y: k65.y + 30 }, { shift: true });
  const locked = await keysOf("transform.x");
  check("Shift-drag changes value only", locked[1].f === before[1].f && locked[1].v < before[1].v, { before: before[1], after: locked[1] });
  await page.keyboard.press("Control+Z");
  await settle();

  // ---- bezier handle --------------------------------------------------------------------
  await graphKey(15).click();
  await settle();
  const out = page.locator('.kf-handle[data-handle="out"] .kf-handle-dot');
  check("selecting a key shows its bezier handles", (await out.count()) === 1, await out.count());
  const h0 = await center(out);
  await drag(h0, { x: h0.x + 10, y: h0.y - 40 });
  const bez = await keysOf("transform.x");
  check("dragging a handle stores a bezier", Array.isArray(bez[0].ease) && bez[0].ease.length === 4, bez[0].ease);
  await pixelsMatch("bezier: pixels follow paramAt", 45);
  await shot("4-bezier");
  await page.keyboard.press("Control+Z");
  await settle();
  check("undo restores the curve", (await keysOf("transform.x"))[0].ease === "easeIn", (await keysOf("transform.x"))[0]);

  // ---- undo the graph drag, then the easing: back to the original ------------------------
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Z");
  await settle();
  check("undo restores the original keys", JSON.stringify(await allKeys()) === JSON.stringify(original), await allKeys());
  await pixelsMatch("after undo: pixels follow paramAt", 45);

  // ---- timeline diamonds: tooltip, drag with snapping to the playhead ----------------------
  const diamond = (i) => page.locator(".clip.selected .clip-key").nth(i);
  check("diamond tooltip names the parameters", /Position X/.test((await diamond(1).getAttribute("data-tip")) ?? ""), await diamond(1).getAttribute("data-tip"));
  await ve(() => window.videoEditor.seek(90));
  await settle();
  const d1 = await center(diamond(1));
  await drag(d1, { x: d1.x + 15 * zoom - 3, y: d1.y });
  const snapped = await keysOf("transform.x");
  check("diamond drag snaps to the playhead", snapped[1].f === 90, snapped);
  await pixelsMatch("after diamond drag: pixels follow paramAt", 45);
  await shot("5-diamond-drag");
  await page.keyboard.press("Control+Z");
  await settle();

  // ---- a diamond is selectable and Delete removes it, not the clip -------------------------
  await diamond(0).click();
  await settle();
  const sel = await ve(() => window.videoEditor.state().keySel);
  check("clicking a diamond selects its keys", sel?.keys?.length === 1 && sel.keys[0].f === 15, sel);
  await page.keyboard.press("Delete");
  await settle();
  const afterDel = await keysOf("transform.x");
  const clipStill = await ve((id) => window.videoEditor.project().tracks.some((t) => t.clips.some((c) => c.id === id)), clipId);
  check("Delete removes the selected keyframe and keeps the clip", afterDel?.length === 1 && afterDel[0].f === 75 && clipStill, afterDel);
  await page.keyboard.press("Control+Z");
  await settle();
  check("undo brings the keyframe back", (await keysOf("transform.x"))?.length === 2, await keysOf("transform.x"));

  // ---- Shift+click in the graph adds a key where clicked ------------------------------------
  const area = await page.locator(".kf-area").boundingBox();
  const graphY = area.y + area.height - 30;
  const scrollLeft = await page.locator(".tl-scroll").evaluate((el) => el.scrollLeft);
  const xFor = (f) => area.x + f * zoom - scrollLeft;
  await page.keyboard.down("Shift");
  await page.mouse.click(xFor(105), graphY);
  await page.keyboard.up("Shift");
  await settle();
  const added = await keysOf("transform.x");
  check("Shift+click adds a keyframe at that frame", added.length === 3 && added[2].f === 105 && added[2].v < 0.3, added);

  // ---- box-select every key, copy, paste at the playhead --------------------------------
  await drag({ x: xFor(5), y: area.y + 2 }, { x: xFor(115), y: area.y + area.height - 4 });
  const boxed = await ve(() => window.videoEditor.state().keySel);
  check("box select picks the keys inside", boxed?.keys?.length === 3, boxed);
  await page.keyboard.press("Control+C");
  await ve(() => window.videoEditor.seek(40));
  await page.keyboard.press("Control+V");
  await settle();
  const pasted = await keysOf("transform.x");
  check("paste lands the copied keys at the playhead, spacing kept, past-the-end dropped", pasted.map((k) => k.f).join() === "15,40,75,100,105", pasted.map((k) => k.f));
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Z");
  await settle();
  check("undo after paste and add restores the original", JSON.stringify(await allKeys()) === JSON.stringify(original), await allKeys());

  // ---- clicking empty graph space seeks ----------------------------------------------------
  await page.keyboard.press("Escape");
  await page.mouse.click(xFor(100), graphY);
  await settle();
  const ph = await ve(() => window.videoEditor.state().playhead);
  check("clicking the graph moves the playhead there", Math.abs(ph - 100) <= 1, ph);

  // ---- inspector: section diamond keys all of Transform; the easing button --------------------
  await ve(() => window.videoEditor.seek(30));
  await settle();
  await page.locator(".section-key").click();
  await settle();
  const all = await allKeys();
  check(
    "Transform's section diamond keys every transform property",
    ["transform.scale", "transform.x", "transform.y", "transform.rotation"].every((p) => all[p]?.some((k) => k.f === 30)),
    Object.keys(all),
  );
  check("new lanes appear in the panel", (await page.locator(".kf-lane-label").count()) === 4, await page.locator(".kf-lane-label").allTextContents());
  await shot("6-section-key");
  await page.locator(".insp-row", { hasText: "Scale" }).locator("button.key-ease").click();
  await page.locator(".ease-item", { has: page.locator(".menu-label", { hasText: /^Overshoot$/ }) }).click();
  await settle();
  check("the inspector's easing button sets a preset", JSON.stringify((await keysOf("transform.scale"))[0].ease) === "[0.34,1.56,0.64,1]", (await keysOf("transform.scale"))[0]);
  await page.locator(".section-key").click();
  await settle();
  const cleared = await allKeys();
  check("clicking it again removes them all", !cleared["transform.scale"] && cleared["transform.x"].length === 2, cleared);
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Z");
  await settle();
  check("undo restores the keys from before the section diamond", JSON.stringify(await allKeys()) === JSON.stringify(original), await allKeys());

  // ---- commands reach the same edits ---------------------------------------------------------
  await ve((id) => {
    const v = window.videoEditor;
    v.exec("move_keyframe", { clip_id: id, path: "transform.x", at: 2.5, to: 2 });
    v.exec("set_keyframe_ease", { clip_id: id, at: 0.5, ease: "smooth" });
  }, clipId);
  const viaCmd = await keysOf("transform.x");
  check("move_keyframe and set_keyframe_ease edit the same keys", viaCmd[1].f === 60 && JSON.stringify(viaCmd[0].ease) === "[0.65,0,0.35,1]", viaCmd);
  await pixelsMatch("after commands: pixels follow paramAt", 30);
  await ve((id) => window.videoEditor.exec("remove_keyframes", { clip_id: id }), clipId);
  check("remove_keyframes clears the animation", (await allKeys()) === null, await allKeys());
  await settle();
  check("the panel offers quick keys when nothing is animated", await page.locator(".kf-quick").isVisible(), null);
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Z");
  await settle();

  // ---- reduced motion: the panel's entrance does not animate -----------------------------------
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Alt+K");
  await page.keyboard.press("Alt+K");
  await settle();
  const dur = await page.locator(".kf-dock").evaluate((el) => getComputedStyle(el).animationDuration);
  check("reduced motion turns the panel's animation off", dur === "0s", dur);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await shot("7-final");

  return { ok: details.every((d) => d.pass), details };
};
