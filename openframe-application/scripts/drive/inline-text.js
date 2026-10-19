// Inline text drive: CapCut's double-click-to-type on the canvas
// (ADR-030, ADR-031). Builds a title over a dark clip, double-clicks it in
// the viewer, types, and checks each step three ways: the document, the
// viewer's pixels, and where the editor's own glyphs land against the
// engine's, line by line (painted red for one screenshot over a hidden
// canvas). Also: shortcuts stay off while typing, Escape, one undo step, a
// click outside, Enter on a selected title, the inspector's Text box,
// captions (viewer and timeline double-click), reduced motion.
//
// Needs the dev server. Run through any Playwright page (playwright-core
// with the system Edge, or the MCP tool's `filename`); it reuses the page's
// origin when it is already on localhost, else opens :1420. Returns
// { ok, details }: ok is true when every check passed. Screenshots go to
// scripts/drive/shots/.
async (page) => {
  const origin = /^http:\/\/localhost:\d+/.exec(page.url())?.[0] ?? "http://localhost:1420";
  await page.goto(origin);
  await page.waitForFunction(() => !!window.videoEditor);
  if (await page.locator(".create-card").isVisible()) await page.click(".create-card");
  await page.waitForSelector(".timeline-panel");

  const details = [];
  const check = (name, pass, seen) => details.push({ name, pass: !!pass, seen });
  const ve = (fn, arg) => page.evaluate(fn, arg);
  const settle = () => page.waitForTimeout(120);
  const shot = (n, clip) => page.screenshot({ path: `scripts/drive/shots/inline-text-${n}.png`, clip, caret: "initial" }).catch(() => {});
  const clipOf = (id) => ve((i) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === i) ?? null, id);
  const textOf = async (id) => (await clipOf(id))?.text;
  const st = () => ve(() => window.videoEditor.state());
  const editorOpen = () => page.locator(".te-text").count().then((n) => n === 1);
  /** A fingerprint of the viewer's pixels once the current frame is drawn. */
  const frameSig = () =>
    ve(async () => {
      const v = window.videoEditor;
      await new Promise((r) => setTimeout(r, 30));
      await v.rendered();
      const { data } = v.pixels();
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum = (sum + data[i] * 3 + data[i + 1] * 7 + data[i + 2] * 11 + i) % 1e9;
      return sum;
    });
  const boxCenter = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

  // Ink rows inside a region, grouped into lines of text: { top, bottom,
  // left, right } each, in the region's pixels. White ink is the engine's,
  // red ink the editor's own glyphs made visible.
  await ve(() => {
    window.__inkLines = (data, w, rx0, ry0, rx1, ry1, red) => {
      const lines = [];
      let cur = null;
      for (let y = ry0; y < ry1; y++) {
        let l = Infinity;
        let r = -1;
        for (let x = rx0; x < rx1; x++) {
          const i = (y * w + x) * 4;
          const on = red ? data[i] > 128 && data[i + 1] < 90 && data[i + 2] < 90 : data[i] > 128 && data[i + 1] > 128 && data[i + 2] > 128;
          if (on) {
            if (x < l) l = x;
            r = x + 1;
          }
        }
        if (r < 0) cur = null;
        else if (!cur) lines.push((cur = { top: y, bottom: y + 1, left: l, right: r }));
        else Object.assign(cur, { bottom: y + 1, left: Math.min(cur.left, l), right: Math.max(cur.right, r) });
      }
      return lines;
    };
  });

  /** The engine's glyphs under the edit frame, line by line, in page pixels. */
  const engineInk = () =>
    ve(async () => {
      const v = window.videoEditor;
      await new Promise((r) => setTimeout(r, 30));
      await v.rendered();
      const { width: w, height: h, data } = v.pixels();
      const c = document.querySelector(".player-canvas").getBoundingClientRect();
      const f = document.querySelector(".te-frame").getBoundingClientRect();
      const kx = c.width / w, ky = c.height / h;
      const x0 = Math.max(0, Math.floor((f.left - c.left) / kx)), y0 = Math.max(0, Math.floor((f.top - c.top) / ky));
      const x1 = Math.min(w, Math.ceil((f.right - c.left) / kx)), y1 = Math.min(h, Math.ceil((f.bottom - c.top) / ky));
      return window.__inkLines(data, w, x0, y0, x1, y1, false).map((l) => ({ top: c.top + l.top * ky, bottom: c.top + l.bottom * ky, left: c.left + l.left * kx, right: c.left + l.right * kx }));
    });

  /** The editor's own glyphs, painted red over a hidden canvas, line by line
   * in page pixels. Saves that screenshot too. */
  const ghostInk = async (name) => {
    await page.keyboard.press("Control+End"); // a selection paints its glyphs transparent
    await ve(() => {
      document.querySelector(".te-text").style.color = "#ff0000";
      document.querySelector(".player-canvas").style.visibility = "hidden";
    });
    const f = await page.locator(".te-frame").boundingBox();
    // Screenshot crops snap to device pixels. Use explicit integer bounds
    // so the measured ink has the same origin as the captured image.
    const clip = { x: Math.floor(f.x), y: Math.floor(f.y), width: Math.ceil(f.x + f.width) - Math.floor(f.x), height: Math.ceil(f.y + f.height) - Math.floor(f.y) };
    const png = await page.screenshot({ clip });
    await shot(`ghost-${name}`, clip);
    await ve(() => {
      document.querySelector(".te-text").style.color = "";
      document.querySelector(".player-canvas").style.visibility = "";
    });
    return ve(
      async ({ b64, clip }) => {
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const ctx = new OffscreenCanvas(img.width, img.height).getContext("2d");
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, img.width, img.height);
        const kx = clip.width / img.width, ky = clip.height / img.height;
        return window.__inkLines(data, img.width, 0, 0, img.width, img.height, true).map((l) => ({ top: clip.y + l.top * ky, bottom: clip.y + l.bottom * ky, left: clip.x + l.left * kx, right: clip.x + l.right * kx }));
      },
      { b64: png.toString("base64"), clip },
    );
  };

  /** Every line of the editor's glyphs within `tol` page pixels of the
   * engine's, on all four sides, and within a pixel and a half on average
   * vertically. Single edges scatter about a pixel and a half: CSS snaps
   * each baseline to a whole pixel, the compositor resamples the engine's
   * raster. The average sees through that; without the baseline correction
   * the 140 px title is off by three to four pixels. */
  const aligned = async (name, tol = 2.5) => {
    const e = await engineInk();
    const g = await ghostInk(name);
    const offsets = g.map((l, i) => e[i] && Object.fromEntries(["left", "right", "top", "bottom"].map((k) => [k, +(l[k] - e[i][k]).toFixed(2)])));
    const ys = offsets.flatMap((o) => (o ? [o.top, o.bottom] : []));
    const meanY = +(ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length)).toFixed(2);
    const pass = e.length > 0 && g.length === e.length && Math.abs(meanY) <= 1.5 && offsets.every((o) => Object.values(o).every((v) => Math.abs(v) <= tol));
    check(`the editor's glyphs sit on the engine's, line by line (${name})`, pass, { lines: e.length, meanY, offsetPx: offsets });
  };

  // ---- setup: a white title over a dark slate clip ------------------------------
  const id = await ve(() => {
    const v = window.videoEditor;
    v.exec("add_color_clip", { color: "#203040", start: 0, duration: 5 });
    v.exec("add_text", { text: "Hello world", start: 0, duration: 5, style: { size: 140 } });
    const c = v.describe().tracks.flatMap((t) => t.clips).find((x) => x.type === "text");
    v.select([c.id]);
    v.seek(30);
    return c.id;
  });
  await settle();
  const textAt = await boxCenter(".tf-box");
  await ve(() => window.videoEditor.select([]));
  const before = await frameSig();

  // ---- double-click the text in the viewer -----------------------------------
  await page.mouse.dblclick(textAt.x, textAt.y);
  await settle();
  const entry = await ve(() => {
    const t = document.querySelector(".te-text");
    return t && { focused: document.activeElement === t, from: t.selectionStart, to: t.selectionEnd, length: t.value.length, fullscreen: !!document.fullscreenElement };
  });
  check("double-clicking the text opens the editor, focused", entry?.focused, entry);
  check("the editor opens with all the text selected, as CapCut", entry && entry.from === 0 && entry.to === entry.length && entry.length === 11, entry);
  check("the double-click does not take the viewer full screen", entry && !entry.fullscreen, entry);
  check("the store names the clip being edited", (await st()).textEdit === id, (await st()).textEdit);
  await shot("1-entry");

  // ---- typing replaces the selection, and the frame redraws live -------------------
  await page.keyboard.type("Typed live");
  check("typing replaces the selected text in the project", (await textOf(id)) === "Typed live", await textOf(id));
  const typed = await frameSig();
  check("the viewer's pixels change while typing", typed !== before, { before, typed });
  check("the inspector's Text box mirrors the canvas", (await page.locator(".inspector-panel .text-area").inputValue()) === "Typed live", null);
  check("nothing is committed while typing", (await st()).undoLabel === "Add text", (await st()).undoLabel);
  await shot("2-typing");

  // ---- shortcuts stay off while typing ------------------------------------------
  const clipsBefore = (await ve(() => window.videoEditor.describe().tracks.flatMap((t) => t.clips).length));
  await page.keyboard.type(" S jkl BMQWV");
  await page.keyboard.press("Control+B");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  await settle();
  const s1 = await st();
  check("space, S, J/K/L, B, M, Q, W, V typed while editing went into the text", (await textOf(id)) === "Typed live S jkl BMQW", await textOf(id));
  check("...and did not play, split, mark, trim, switch tools or toggle", !s1.playing && !s1.previewAxis && s1.tool === "select" && (await ve(() => window.videoEditor.project().markers.length)) === 0 && !(await clipOf(id)).disabled, { playing: s1.playing, previewAxis: s1.previewAxis, tool: s1.tool });
  check("Ctrl+B, Backspace and Delete left the clips alone", (await ve(() => window.videoEditor.describe().tracks.flatMap((t) => t.clips).length)) === clipsBefore && (await clipOf(id))?.duration === 150, clipsBefore);

  // ---- Enter breaks the line in a title ---------------------------------------
  await page.keyboard.press("Enter");
  await page.keyboard.type("Line two");
  check("Enter breaks the line in a title", (await textOf(id)) === "Typed live S jkl BMQW\nLine two", await textOf(id));
  await settle();
  await aligned("two lines, centered");
  await shot("3-two-lines");

  // ---- Escape commits one undo step and keeps the clip selected -----------------
  await page.keyboard.press("Escape");
  await settle();
  const s2 = await st();
  check("Escape closes the editor", !(await editorOpen()) && s2.textEdit === null, s2.textEdit);
  check("Escape keeps the clip selected", s2.selection.length === 1 && s2.selection[0] === id, s2.selection);
  check("the session is one undo step, Edit text", s2.undoLabel === "Edit text", s2.undoLabel);
  await page.keyboard.press("Control+Z");
  await settle();
  check("one undo restores the text from before editing", (await textOf(id)) === "Hello world", await textOf(id));
  check("...and the frame from before editing", (await frameSig()) === before, null);
  await page.keyboard.press("Control+Shift+Z");
  check("redo brings the whole session back", (await textOf(id)) === "Typed live S jkl BMQW\nLine two", await textOf(id));

  // ---- Enter on a selected title opens the editor; leaving unchanged records nothing
  await page.keyboard.press("Enter");
  await settle();
  check("Enter on a selected title opens the editor", await editorOpen(), null);
  await page.keyboard.press("Escape");
  await settle();
  check("a session that changed nothing adds no undo step", (await st()).undoLabel === "Edit text" && (await st()).redoLabel === null, { undo: (await st()).undoLabel, redo: (await st()).redoLabel });

  // ---- the editor sits on the glyphs: left-aligned, then turned -----------------
  await ve((i) => window.videoEditor.exec("set_text", { clip_id: i, style: { align: "left" } }), id);
  await page.keyboard.press("Enter");
  await settle();
  await aligned("two lines, left");
  await page.keyboard.press("Escape");
  await ve((i) => window.videoEditor.exec("set_text", { clip_id: i, style: { align: "right" } }), id);
  await page.keyboard.press("Enter");
  await settle();
  await aligned("two lines, right");
  await page.keyboard.press("Escape");
  await ve((i) => {
    const v = window.videoEditor;
    v.exec("set_text", { clip_id: i, text: "Turned title", style: { align: "center" } });
    v.exec("set_param", { clip_ids: [i], path: "transform.rotation", value: 15 });
  }, id);
  await settle();
  await page.mouse.dblclick(...Object.values(await boxCenter(".tf-box")));
  await settle();
  await aligned("turned 15 degrees", 3);
  await shot("4-turned");

  // ---- a click outside commits ------------------------------------------------
  await page.keyboard.press("Control+End");
  await page.keyboard.type("!");
  const empty = await page.locator(".timeline-panel").boundingBox();
  await page.mouse.click(empty.x + empty.width - 60, empty.y + empty.height - 30);
  await settle();
  check("a click outside closes the editor and keeps the text", !(await editorOpen()) && (await textOf(id)) === "Turned title!", await textOf(id));
  check("...as one Edit text step", (await st()).undoLabel === "Edit text", (await st()).undoLabel);

  // ---- the inspector's Text box is live and one step too ----------------------------
  await ve((i) => {
    window.videoEditor.select([i]);
    window.videoEditor.seek(30); // the click outside moved the playhead
  }, id);
  await settle();
  const sig0 = await frameSig();
  await page.locator(".inspector-panel .text-area").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("From the inspector");
  check("the inspector's Text box changes the project as you type", (await textOf(id)) === "From the inspector", await textOf(id));
  check("...and the viewer redraws before you leave the box", (await frameSig()) !== sig0, null);
  await page.locator(".player-panel .panel-head").click();
  await settle();
  check("leaving the inspector box commits one Edit text step", (await st()).undoLabel === "Edit text", (await st()).undoLabel);
  await page.keyboard.press("Control+Z");
  check("...which one undo reverts", (await textOf(id)) === "Turned title!", await textOf(id));

  // ---- captions edit the same way; Enter finishes, Ctrl+Enter breaks the line -------
  const cap = await ve(() => {
    const v = window.videoEditor;
    v.exec("add_captions", { captions: [{ start: 0, end: 2.5, text: "First caption" }, { start: 2.5, end: 5, text: "Second caption" }] });
    const c = v.describe().tracks.flatMap((t) => t.clips).find((x) => x.text === "First caption");
    v.select([c.id]);
    v.seek(30);
    return c.id;
  });
  await settle();
  await page.mouse.dblclick(...Object.values(await boxCenter(".tf-box")));
  await settle();
  check("double-clicking a caption opens the editor", await editorOpen(), null);
  await page.keyboard.type("Edited caption");
  await page.keyboard.press("Enter");
  await settle();
  check("Enter finishes a caption, without a line break", !(await editorOpen()) && (await textOf(cap)) === "Edited caption", await textOf(cap));
  await page.keyboard.press("Enter");
  await settle();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("two");
  check("Ctrl+Enter breaks the line in a caption", (await textOf(cap)) === "Edited caption\ntwo", await textOf(cap));
  await aligned("caption");
  await shot("5-caption");
  await page.keyboard.press("Escape");

  // ---- double-click a caption on the timeline, as in CapCut -----------------------
  const cap2 = await ve(() => window.videoEditor.describe().tracks.flatMap((t) => t.clips).find((x) => x.text === "Second caption").id);
  await page.locator(`[data-clip="${cap2}"]`).dblclick();
  await settle();
  const s3 = await st();
  check("double-clicking a caption on the timeline opens the canvas editor on it", (await editorOpen()) && s3.textEdit === cap2, s3.textEdit);
  check("...with the playhead brought into that caption", s3.playhead >= 75 && s3.playhead < 150, s3.playhead);
  await page.keyboard.press("Escape");

  // ---- reduced motion: the edit box appears without the fade ------------------------
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Enter");
  await settle();
  const dur = await page.locator(".te-frame").evaluate((el) => getComputedStyle(el).animationDuration);
  check("reduced motion turns the edit box's fade off", dur === "0s", dur);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.keyboard.press("Enter");
  const fade = await page.locator(".te-frame").evaluate((el) => getComputedStyle(el).animationDuration);
  check("otherwise the edit box fades in", fade !== "0s", fade);
  await page.keyboard.press("Escape");

  return { ok: details.every((d) => d.pass), details };
};
