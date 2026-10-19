// The player and the timeline at every window size (the 2026-10-19 UI
// sweep): 900 x 600 and 1024 x 640 (a narrow browser tab, which only has
// to degrade gracefully), the desktop window's 1100 x 680 minimum, and
// 1280 x 720 up to 2560 x 1440. A project with every clip kind, long
// media, track and marker names, eleven tracks, a compound clip, keys and
// a transition; Ollama is stubbed so no installed model's name is shown.
// At each size it opens the player's and the timeline's every state: zoom
// at both ends, the tool, display, clip, track, background and history
// menus, the track volume popover, the mixer, the viewer guides, the
// splitters at their limits (a narrow player, a wide inspector, a short
// and a tall timeline), the docked AI assistant, crop, the keyframe panel,
// the compound path, the source monitor, the trim preview and full screen.
// In each it checks for page scroll, text cut off with no ellipsis, text
// spilling out of a control, controls cut off or overlapping, popups
// leaving the window, toolbar buttons squeezed below their size, track
// header parts outside their header, and the playhead or a marker drawn
// over the track headers when the timeline is scrolled.
// Screenshots go to scratch/sizes-timeline/. SIZES=1100x680,1600x940 in
// the environment limits the run to those sizes.
async (page) => {
  page.setDefaultTimeout(6000);
  const fs = await import("node:fs");
  const base = "http://localhost:1420";
  const shots = "__REPO__/scratch/sizes-timeline";
  fs.mkdirSync(shots, { recursive: true });
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await page.context().route("http://127.0.0.1:11434/**", (r) => r.fulfill({ headers: cors, json: { models: [{ name: "llama3.1:8b" }] } }));
  const all = [
    [900, 600],
    [1024, 640],
    [1100, 680],
    [1280, 720],
    [1366, 768],
    [1440, 900],
    [1600, 940],
    [1920, 1080],
    [2560, 1440],
  ];
  const only = process.env.SIZES?.split(",");
  const sizes = only ? all.filter(([w, h]) => only.includes(`${w}x${h}`)) : all;

  // ---- the audit: what a screenshot review would catch, measured -------------------
  // The style sweep's checks (style-sweep.js), kept to this area's parts.
  const AREA = ".player-panel, .timeline-panel, .mixer, .ctx-anchor, .tl-vol-pop, .source-monitor";
  const audit = (label) =>
    page.evaluate(
      ({ label, AREA }) => {
        const faults = [];
        const style = new Map();
        const css = (e) => style.get(e) ?? (style.set(e, getComputedStyle(e)), style.get(e));
        const shownMemo = new Map();
        const shown = (e) => {
          if (!e || e === document.documentElement) return true;
          if (shownMemo.has(e)) return shownMemo.get(e);
          const cs = css(e);
          const v = cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) >= 0.05 && shown(e.parentElement);
          shownMemo.set(e, v);
          return v;
        };
        const cut = (r, b) => ({ left: Math.max(r.left, b.left), top: Math.max(r.top, b.top), right: Math.min(r.right, b.right), bottom: Math.min(r.bottom, b.bottom) });
        const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
        const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
        const clipMemo = new Map();
        const clipFor = (e) => {
          if (!e || e === document.body || e === document.documentElement) return { all: view, fixed: view };
          if (clipMemo.has(e)) return clipMemo.get(e);
          const cs = css(e);
          let c = cs.position === "fixed" ? { all: view, fixed: view } : clipFor(e.parentElement);
          if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
            const b = e.getBoundingClientRect();
            const scroller = /(auto|scroll)/.test(cs.overflowX + cs.overflowY);
            c = { all: cut(c.all, b), fixed: scroller || !c.fixed ? null : cut(c.fixed, b) };
          }
          clipMemo.set(e, c);
          return c;
        };
        const parentClip = (el) => (css(el).position === "fixed" ? { all: view, fixed: view } : clipFor(el.parentElement));
        // What scrolls in the timeline passes under its sticky ruler, and a
        // lane's contents under the sticky header column too.
        const scroller = document.querySelector(".tl-scroll")?.getBoundingClientRect();
        const headerW = document.querySelector(".tl-corner")?.offsetWidth ?? 0;
        const sticky = (el, r) => {
          if (!scroller || !el.closest(".tl-rows")) return r;
          return cut(r, { left: scroller.left + (el.closest(".tl-lane") ? headerW : 0), top: scroller.top + 28, right: scroller.right, bottom: scroller.bottom });
        };
        const seen = (el) => sticky(el, cut(el.getBoundingClientRect(), parentClip(el).all));
        const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 40);
        const where = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} "${name(el)}"`;
        const add = (kind, el, extra = {}) => faults.push({ state: label, kind, el: el ? where(el) : "", ...extra });
        const rect = (el) => el.getBoundingClientRect();
        const inside = (a, b, s = 0.5) => a.left >= b.left - s && a.right <= b.right + s && a.top >= b.top - s && a.bottom <= b.bottom + s;
        if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1)
          add("page-scroll", null, { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight });
        // In full screen only the player shows.
        const top = document.fullscreenElement;
        const mine = [...document.querySelectorAll("body *")].filter((el) => el.closest(AREA) && (!top || top.contains(el)) && shown(el) && area(seen(el)) > 0);
        const controls = mine.filter((el) => el.matches("button, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], input, select, textarea, a[href]"));
        for (const el of mine) {
          const cs = css(el);
          const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (ownText && /(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1)
            add("clipped-text", el, { scroll: el.scrollWidth, client: el.clientWidth });
          const pc = ownText ? parentClip(el).fixed : null;
          const tr = rect(el);
          if (pc && (tr.right > pc.right + 1 || tr.left < pc.left - 1) && area(cut(tr, pc)) > 0) add("clipped-text", el, { rect: [tr.left, tr.right].map(Math.round), clip: [pc.left, pc.right].map(Math.round) });
          if (el.matches("button, [role=tab], [role=menuitem], label") && el.textContent.trim() && el.scrollWidth > el.clientWidth + 2 && cs.overflowX === "visible") add("text-spills", el, { scroll: el.scrollWidth, client: el.clientWidth });
        }
        const seenOf = new Map();
        for (const el of controls) {
          seenOf.set(el, seen(el));
          const r = rect(el);
          const c = parentClip(el).fixed;
          if (c && (r.left < c.left - 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.bottom > c.bottom + 1))
            add("cut-off", el, { rect: [r.left, r.top, r.right, r.bottom].map(Math.round), clip: [c.left, c.top, c.right, c.bottom].map(Math.round) });
        }
        // Popups cover the app; markers and keyframe diamonds sit by time
        // and may touch.
        const popup = (el) => !!el.closest(".menu, dialog, [role=dialog], .ctx-anchor");
        const timed = (a, b) => (a.matches(".tl-marker") && b.matches(".tl-marker")) || (a.matches(".clip-key") && b.matches(".clip-key"));
        for (let i = 0; i < controls.length; i++)
          for (let j = i + 1; j < controls.length; j++) {
            const a = controls[i], b = controls[j];
            if (a.contains(b) || b.contains(a) || popup(a) !== popup(b) || timed(a, b)) continue;
            const p = seenOf.get(a), q = seenOf.get(b);
            const w = Math.min(p.right, q.right) - Math.max(p.left, q.left), h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
            if (w > 2 && h > 2) add("overlap", a, { with: where(b), w: Math.round(w), h: Math.round(h) });
          }

        // Popups stay in the window.
        for (const el of document.querySelectorAll(".menu, .tl-vol-pop, .mixer, dialog[open]")) {
          if (!shown(el)) continue;
          const r = rect(el);
          if (!inside(r, view)) add("off-screen", el, { rect: [r.left, r.top, r.right, r.bottom].map(Math.round) });
        }
        // The timeline toolbar: every button in the bar at its full size.
        const bar = document.querySelector(".tl-toolbar");
        if (bar) {
          const b = rect(bar);
          for (const el of bar.querySelectorAll("button, input")) {
            if (!shown(el) || el.closest(".menu")) continue;
            const r = rect(el);
            if (!inside(r, b)) add("toolbar-out", el, { rect: [r.left, r.right].map(Math.round), bar: [b.left, b.right].map(Math.round) });
            if (el.matches(".icon-btn") && r.width < 27.5) add("toolbar-squeezed", el, { width: r.width });
          }
        }
        // The transport and the player's header stay inside the player.
        const player = document.querySelector(".player-panel");
        if (player) {
          const p = rect(player);
          for (const el of player.querySelectorAll(".transport button, .transport select, .transport input, .panel-head button, .panel-head select")) {
            if (!shown(el)) continue;
            const r = rect(el);
            if (!inside(r, p)) add("player-out", el, { rect: [r.left, r.top, r.right, r.bottom].map(Math.round), player: [p.left, p.top, p.right, p.bottom].map(Math.round) });
          }
          const play = player.querySelector(".play-btn");
          if (play && shown(play) && rect(play).width < 33.5) add("player-squeezed", play, { width: rect(play).width });
        }
        // The mixer: strips of one width (a long name stretched its strip),
        // the panel no wider than its strips, the master strip in view.
        const strips = document.querySelector(".mix-strips");
        if (strips) {
          const s = rect(strips);
          for (const el of strips.querySelectorAll(".mix-strip")) if (Math.abs(rect(el).width - 142) > 0.5) add("mixer-strip", el, { width: rect(el).width });
          const last = rect(strips.lastElementChild);
          if (strips.scrollWidth <= strips.clientWidth + 1 && s.right - last.right > 1) add("mixer-empty", strips, { gap: s.right - last.right });
          if (!inside(last, s)) add("mixer-master", strips.lastElementChild, { master: [last.left, last.right], strips: [s.left, s.right] });
        }
        // Track headers: the name and the toggles apart, inside.
        for (const head of document.querySelectorAll(".tl-header")) {
          const h = rect(head);
          const kind = head.querySelector(".tl-kind, .tl-rename");
          const toggles = head.querySelector(".tl-toggles");
          if (!kind || !toggles) continue;
          const [k, t] = [rect(kind), rect(toggles)];
          const apart = k.right <= t.left + 0.5 || k.bottom <= t.top + 0.5;
          if (!inside(k, h) || !inside(t, h) || !apart) add("track-header", head, { name: [k.left, k.top, k.right, k.bottom].map(Math.round), toggles: [t.left, t.top, t.right, t.bottom].map(Math.round), head: [h.left, h.top, h.right, h.bottom].map(Math.round) });
          const nameEl = head.querySelector(".tl-track-name");
          if (nameEl && nameEl.scrollWidth > nameEl.clientWidth + 1 && !(head.querySelector(".tl-kind")?.getAttribute("data-tip") ?? "").includes(nameEl.textContent))
            add("track-name-hidden", nameEl, { tip: head.querySelector(".tl-kind")?.getAttribute("data-tip") });
        }
        return faults;
      },
      { label, AREA },
    );

  // White (the playhead) or magenta (a test marker) pixels drawn over the
  // track header column, read from a screenshot of it.
  const headerInk = async () => {
    const col = await page.evaluate(() => {
      const s = document.querySelector(".tl-scroll").getBoundingClientRect();
      const corner = document.querySelector(".tl-corner").getBoundingClientRect();
      return { x: Math.ceil(s.left), y: Math.ceil(s.top), width: Math.floor(corner.width) - 2, height: Math.floor(Math.min(s.height, innerHeight - s.top)) - 2 };
    });
    const png = (await page.screenshot({ clip: col })).toString("base64");
    return page.evaluate(async (png) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const g = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d");
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      let white = 0, magenta = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250) white++;
        if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) magenta++;
      }
      return { white, magenta };
    }, png);
  };

  const faults = [];
  const errors = [];
  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  let size = "";
  // A state: do it, wait out the 180 ms pop-ins, audit, capture, undo it.
  const step = async (label, fn, after) => {
    const name = `${size}-${label}`;
    try {
      await fn();
      await page.waitForTimeout(320);
      faults.push(...(await audit(name)));
      await page.screenshot({ path: `${shots}/${name}.png` });
    } catch (e) {
      errors.push({ state: name, error: String(e).split("\n")[0].slice(0, 200) });
    }
    if (after) await after().catch((e) => errors.push({ state: `${name} (closing)`, error: String(e).split("\n")[0].slice(0, 200) }));
  };
  const escape = () => page.keyboard.press("Escape");
  const act = (id, n = 1) => page.evaluate(([id, n]) => { for (let i = 0; i < n; i++) window.videoEditor.action(id); }, [id, n]);
  const toBottom = () => page.evaluate(() => { const el = document.querySelector(".tl-scroll"); el.scrollTop = el.scrollHeight; });
  // A splitter dragged as far as it goes, toward a point near the window edge.
  const drag = async (sel, i, to) => {
    const box = await page.locator(sel).nth(i).boundingBox();
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(to.x ?? x, to.y ?? y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  const reset = (sel, i) => page.locator(sel).nth(i).dblclick();
  const SPLIT_X = ".top-row > .splitter-x", SPLIT_Y = ".workspace > .splitter-y";

  for (const [w, h] of sizes) {
    size = `${w}x${h}`;
    await page.setViewportSize({ width: w, height: h });
    await page.goto(base);
    await page.waitForFunction(() => !!window.videoEditor);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.videoEditor);
    await page.locator(".create-card").first().click();
    await page.locator(".timeline-panel").waitFor();
    await step("empty", async () => {});
    const ids = await page.evaluate(async () => {
      const api = window.videoEditor;
      const o = location.origin + "/fixtures/media/";
      const [vid, pic, voice, music, fc, gif] = await api.import([
        { name: "Interview with the head of product, camera B, take 4 (final).mp4", src: o + "talk-gaps.mp4" },
        { name: "A wide establishing photograph of the harbor at dawn.jpg", src: o + "photo.jpg" },
        { name: "voice-8s.wav", src: o + "voice-8s.wav" },
        { name: "Background music bed, upbeat corporate, 120 BPM, no vocals.mp3", src: o + "music-30s.mp3" },
        { name: "framecode-30.mp4", src: o + "framecode-30.mp4" },
        { name: "animated.gif", src: o + "animated.gif" },
      ]);
      const x = (n, a) => api.exec(n, a);
      const p = () => api.project();
      const track = (prefix) => p().tracks.find((t) => t.name.startsWith(prefix)).id;
      x("update_track", { track_id: p().tracks[0].id, name: "Main story cut with a long name" });
      x("add_media_clip", { asset_id: vid.id, start: 0, duration: 4 });
      x("add_media_clip", { asset_id: pic.id, start: 4, duration: 3 });
      x("add_media_clip", { asset_id: fc.id, start: 7, duration: 5 });
      x("add_media_clip", { asset_id: vid.id, start: 12, duration: 0.2 });
      x("add_media_clip", { asset_id: vid.id, start: 12.2, duration: 6 });
      const mc = p().tracks.find((t) => t.main).clips;
      x("set_transition", { clip_id: mc[0].id, type: "dissolve", duration: 0.5 });
      x("set_speed", { clip_id: mc[2].id, speed: 2 });
      x("add_effect", { clip_id: mc[1].id, type: "glow" });
      x("set_clip_label", { clip_ids: [mc[4].id], label: "red" });
      x("add_keyframe", { clip_id: mc[0].id, path: "transform.scale", at: 0, value: 1 });
      x("add_keyframe", { clip_id: mc[0].id, path: "transform.scale", at: 2, value: 1.3 });
      x("add_text", { text: "A title that runs on and on across the whole picture", start: 1, duration: 5 });
      x("add_captions", { captions: [{ start: 0, end: 2, text: "first caption line here" }, { start: 2, end: 4, text: "and the second caption" }] });
      x("add_shape", { kind: "rounded_rectangle", start: 6, duration: 3, width: 0.4, height: 0.1 });
      x("add_color_clip", { color: "#334455", start: 9, duration: 3 });
      x("add_adjustment_clip", { start: 2, duration: 4 });
      x("add_track", { kind: "video", name: "Overlay track with an exceptionally long descriptive name for B-roll" });
      x("add_media_clip", { asset_id: gif.id, start: 3, duration: 2, track_id: track("Overlay track with") });
      const gifClip = p().tracks.find((t) => t.name.startsWith("Overlay track with")).clips[0].id;
      x("create_compound_clip", { clip_ids: [gifClip], name: "Animated sticker sequence for the opening, nested twice over" });
      x("add_media_clip", { asset_id: voice.id, start: 0, duration: 8 });
      x("add_media_clip", { asset_id: music.id, start: 0, duration: 20 });
      x("add_track", { kind: "audio", name: "Sound effects and ambience bed for the harbor scene" });
      x("add_media_clip", { asset_id: voice.id, start: 9, duration: 3, track_id: track("Sound effects") });
      for (let i = 1; i <= 3; i++) x("add_track", { kind: "video", name: `Extra ${i}` });
      x("add_markers", { times: [1, 5.5, 9], label: "Chapter: a long marker label to see how it is drawn" });
      x("add_markers", { times: [14], label: "", color: "#f05a5a" });
      api.select([]);
      const clips = p().tracks.flatMap((t) => t.clips);
      return { video: mc[0].id, compound: clips.find((c) => c.type === "compound").id };
    });
    await page.waitForTimeout(600);

    // ---- the default layout -------------------------------------------------------
    await step("default", async () => {
      await act("zoomFit");
      await toBottom();
    });
    // The toolbar keeps one line wherever the editor has its full width.
    const barH = () => page.locator(".tl-toolbar").evaluate((e) => e.offsetHeight);
    check(`${size} toolbar on one line`, (await barH()) <= 38, { height: await barH() });
    await step("zoom-max", async () => {
      await page.evaluate((id) => window.videoEditor.select([id]), ids.video);
      await act("zoomIn", 60);
      await page.evaluate(() => (document.querySelector(".tl-scroll").scrollLeft = 0));
    });
    await step("zoom-min", () => act("zoomOut", 80));
    await act("zoomFit");

    // The playhead and a marker under the header column, scrolled sideways.
    await page.evaluate(() => {
      const ve = window.videoEditor;
      ve.select([]);
      ve.action("zoomIn");
      ve.action("zoomIn");
      const el = document.querySelector(".tl-scroll");
      el.scrollLeft = 400;
      const z = ve.state().zoom;
      ve.seek(Math.round((el.scrollLeft - 60) / z));
      ve.exec("add_markers", { times: [(el.scrollLeft - 100) / z / 30], label: "under", color: "#ff00ff" });
    });
    await page.waitForTimeout(200);
    await page.mouse.move(w / 2, 60); // off the timeline: no hover styles
    const ink = await headerInk();
    check(`${size} playhead and markers under headers`, ink.white === 0 && ink.magenta === 0, ink);
    await page.screenshot({ path: `${shots}/${size}-scrolled.png` });
    await page.evaluate(() => {
      const ve = window.videoEditor;
      ve.action("undo");
      ve.seek(30);
      ve.action("zoomFit");
    });

    // In and out points: the range shows over the ruler.
    await page.evaluate(() => {
      const ve = window.videoEditor;
      ve.seek(30);
      ve.action("markIn");
      ve.seek(120);
      ve.action("markOut");
      // Scrolled down the tracks: the range stays with the ruler.
      const el = document.querySelector(".tl-scroll");
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(150);
    // Its accent underline, read from the screen, on the ruler's bottom edge.
    const range = await page.evaluate(() => {
      const r = document.querySelector(".tl-range")?.getBoundingClientRect();
      const ruler = document.querySelector(".tl-ruler").getBoundingClientRect();
      return r ? { x: Math.round(r.left + r.width / 2), y: Math.floor(r.bottom - 1), rulerBottom: ruler.bottom, bottom: r.bottom } : null;
    });
    const px = range && (await page.screenshot({ clip: { x: range.x, y: range.y, width: 1, height: 1 } }).then((b) => page.evaluate(async (png) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const g = new OffscreenCanvas(1, 1).getContext("2d");
      g.drawImage(bmp, 0, 0);
      return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    }, b.toString("base64"))));
    check(`${size} in-out range shown`, !!px && Math.abs(range.bottom - range.rulerBottom) < 0.5 && px[0] < 40 && px[1] > 160 && px[2] > 170, { range, px });
    await page.screenshot({ path: `${shots}/${size}-range.png`, clip: { x: 0, y: (await page.locator(".tl-scroll").boundingBox()).y - 40, width: w, height: 80 } });
    await page.evaluate(() => window.videoEditor.action("clearInOut"));

    // ---- menus and popovers ------------------------------------------------------------
    await toBottom();
    await step("menu-tool", () => page.locator(".tool-btn").click(), escape);
    await step("menu-display", () => page.getByRole("button", { name: "Timeline display", exact: true }).click(), escape);
    await step("menu-clip", () => page.locator(`[data-clip="${ids.video}"]`).click({ button: "right", position: { x: 20, y: 20 } }), escape);
    await step("menu-track", () => page.locator(".tl-header").last().click({ button: "right" }), escape);
    await step("rename-track", async () => {
      await page.locator(".tl-header").last().dblclick({ position: { x: 30, y: 10 } });
      await page.locator(".tl-rename").waitFor();
    }, escape);
    await step("menu-background", async () => {
      const row = await page.locator(".tl-row").last().boundingBox();
      const head = await page.locator(".tl-corner").boundingBox();
      await page.mouse.click(head.x + head.width + 30, Math.min(row.y + row.height / 2, h - 12), { button: "right" });
    }, escape);
    await step("menu-history", () => page.locator('[data-history="undo"] button').click({ button: "right" }), escape);
    await step("volume-pop", async () => {
      await page.locator(".tl-header").last().click({ button: "right" });
      await page.getByRole("menuitem", { name: /Track volume and pan/ }).click();
      await page.locator(".tl-vol-pop").waitFor();
    }, escape);
    await step("mixer", () => page.getByRole("button", { name: "Mixer", exact: true }).click(), () => page.getByRole("button", { name: "Close mixer" }).click());
    await step("guides", () => page.getByRole("combobox", { name: "Viewer guides" }).selectOption("both"));
    await step("guides-vertical", () => page.getByRole("combobox", { name: "Viewer guides" }).selectOption("vertical"), () => page.getByRole("combobox", { name: "Viewer guides" }).selectOption("off"));
    await step("compound-path", async () => {
      await page.locator(`[data-clip="${ids.compound}"]`).scrollIntoViewIfNeeded();
      await page.locator(`[data-clip="${ids.compound}"]`).dblclick();
      await page.locator(".tl-path").waitFor();
    }, () => page.getByRole("button", { name: "Back out of the compound clip" }).click());
    await step("fullscreen", async () => {
      await page.getByRole("button", { name: "Full screen", exact: true }).click();
      await page.waitForFunction(() => !!document.fullscreenElement);
    }, () => page.evaluate(() => document.exitFullscreen()));
    if (await page.locator(".media-card").count())
      await step("source-monitor", async () => {
        await page.getByRole("button", { name: /^Preview Interview with/ }).click();
        await page.locator("dialog.source-monitor").waitFor();
      }, escape);

    // ---- the splitters at their limits ---------------------------------------------------
    // The library as wide as it goes: the player at its narrowest.
    await step("narrow-player", () => drag(SPLIT_X, 0, { x: w - 4 }));
    await step("narrow-player-crop", async () => {
      await page.evaluate((id) => window.videoEditor.select([id]), ids.video);
      await page.locator(".tl-toolbar").getByRole("button", { name: "Crop", exact: true }).click();
      await page.locator(".crop-bar").waitFor();
    }, () => page.locator(".crop-bar").getByRole("button", { name: "Cancel" }).click());
    await reset(SPLIT_X, 0);
    await step("wide-inspector", () => drag(SPLIT_X, 1, { x: 4 }), () => reset(SPLIT_X, 1));
    // The top row as tall as it goes: a short timeline.
    await step("short-timeline", () => drag(SPLIT_Y, 0, { y: h - 4 }));
    await step("short-timeline-display", () => page.getByRole("button", { name: "Timeline display", exact: true }).click(), escape);
    await step("short-timeline-keyframes", async () => {
      await page.evaluate((id) => window.videoEditor.select([id]), ids.video);
      await act("toggleKeyframePanel");
    }, () => act("toggleKeyframePanel"));
    await reset(SPLIT_Y, 0);
    // The top row as short as it goes: a tall timeline, a short player.
    await step("tall-timeline", () => drag(SPLIT_Y, 0, { y: 44 }));
    await step("tall-timeline-trim", async () => {
      await page.evaluate((id) => window.videoEditor.select([id]), ids.video);
      await act("zoomFit");
      const clip = page.locator(`[data-clip="${ids.video}"]`);
      await clip.scrollIntoViewIfNeeded();
      const end = await clip.locator(".trim-end").boundingBox();
      // Near its top: the transition's button covers the cut's middle.
      await page.mouse.move(end.x + end.width / 2, end.y + 5);
      await page.mouse.down();
      await page.mouse.move(end.x - 30, end.y + 5, { steps: 6 });
      await page.locator(".trim-preview").waitFor();
    }, async () => {
      await escape();
      await page.mouse.up();
    });
    await reset(SPLIT_Y, 0);

    // ---- the docked AI assistant narrows the editor ------------------------------------------
    await step("assistant", async () => {
      await page.locator(".assistant-btn").click();
      await page.locator("aside.assistant").waitFor();
    });
    // Beside the assistant too, from the desktop window's minimum up; a
    // narrower browser tab wraps it to two lines.
    if (w >= 1100) check(`${size} toolbar on one line beside the assistant`, (await barH()) <= 38, { height: await barH() });
    await step("assistant-tool-menu", () => page.locator(".tool-btn").click(), escape);
    await step("assistant-narrow-player", () => drag(SPLIT_X, 0, { x: 4 }), () => reset(SPLIT_X, 0));
    await page.locator(".assistant-btn").click();
  }

  const by = {};
  for (const f of faults) (by[f.kind] ??= []).push(f);
  for (const [k, list] of Object.entries(by)) details[k] = { ok: false, count: list.length, list };
  details.steps = { ok: errors.length === 0, errors };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
