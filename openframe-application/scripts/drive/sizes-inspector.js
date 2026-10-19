// The inspector at every window size (the desktop window's 1100 x 680
// minimum to 2560 x 1440, and the web build's 1024 x 640 and 900 x 600)
// and at its splitter's narrowest and widest. A project with every clip
// kind (video, image, audio, voiceover, a title with styled runs, a shape,
// a color, an adjustment layer, a compound, a sticker, captions) and every
// option that adds rows turned on; each clip's every tab and sub-tab is
// opened with all its sections, as are the project's details and three
// multi-selections. Each state fails on: the page or the inspector
// scrolling sideways, a tab out of reach, text cut off (without an
// ellipsis, or with one and no tip), text spilling out of its button, a
// button wrapping onto two lines, controls overlapping or cut off, a
// slider squeezed below 56 px, a switch or swatch squeezed, a number or
// select too narrow for its value, and (wide inspectors) a plain row's
// control not starting where the sliders do. Then, per size, the easing
// menu (in the window, and not over its button when there is room), the
// Effect presets and Paste attributes dialogs, the saved-style name row,
// the effect picker, the keyframe panel (empty, quick-add and with lanes)
// and the scopes in the library's place; and the inspector beside the
// docked AI assistant. Ollama is stubbed before the app loads, so no
// installed model's name reaches a result. Screenshots of each size go to
// scratch/sizes-inspector/.
async (page) => {
  page.setDefaultTimeout(8000);
  const base = "http://localhost:1420";
  const shots = "__REPO__/scratch/sizes-inspector";
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
  const tags = { models: [{ name: "llama3.1:8b" }] };
  await page.context().route("http://127.0.0.1:11434/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.url().endsWith("/api/tags")) return route.fulfill({ headers: cors, json: tags });
    return route.fulfill({ status: 404, headers: cors, body: "" });
  });
  await page.context().route("**/api/tags", (route) => route.fulfill({ headers: cors, json: tags }));

  const sizes = [
    [1100, 680], // the desktop window's minimum (tauri.conf.json)
    [1280, 720],
    [1366, 768],
    [1440, 900],
    [1600, 940], // the desktop window's default
    [1920, 1080],
    [2560, 1440],
    [1024, 640], // web only: degrades, never overlaps
    [900, 600],
  ];

  await page.setViewportSize({ width: 1600, height: 940 });
  await page.goto(base);
  await page.locator(".create-card").first().click();
  await page.locator(".timeline-panel").waitFor();
  // Animations off: each state is measured settled, without waiting out
  // the 180 ms rise-ins (layout is the same either way).
  await page.addStyleTag({ content: "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }" });

  const ids = await page.evaluate(async () => {
    const api = window.videoEditor;
    const o = location.origin + "/fixtures/media/";
    api.exec("set_project", { name: "Quarterly product launch, director's cut with the extended interviews (final v7)" });
    const [talk, pan, pic, music, voice, green] = await api.import([
      { name: "Interview with the lead designer about the new camera rig, take 14.mp4", src: o + "talk-gaps.mp4" },
      { name: "person-pan.mp4", src: o + "person-pan.mp4" },
      { name: "Product hero shot on the marble table, golden hour, retouched.jpg", src: o + "photo.jpg" },
      { name: "Upbeat corporate background music, full length mix with stems.mp3", src: o + "music-30s.mp3" },
      { name: "Voiceover - narration for the opening sequence, second pass.wav", src: o + "voice-8s.wav" },
      { name: "green-screen.mp4", src: o + "green-screen.mp4" },
    ]);
    await api.importLuts([{ name: "Teal and orange film emulation, Rec.709 to log.cube", src: o + "identity-33.cube" }]);
    const all = () => new Set(api.project().tracks.flatMap((t) => t.clips.map((c) => c.id)));
    const add = async (name, args) => {
      const before = all();
      await api.exec(name, args);
      return [...all()].find((id) => !before.has(id));
    };
    const c = {};
    c.video = await add("add_media_clip", { asset_id: talk.id, start: 0, duration: 4 });
    c.curve = await add("add_media_clip", { asset_id: pan.id, start: 4, duration: 4 });
    c.image = await add("add_media_clip", { asset_id: pic.id, start: 8, duration: 3 });
    c.audio = await add("add_media_clip", { asset_id: music.id, start: 0, duration: 12 });
    c.voiceover = await add("add_media_clip", { asset_id: voice.id, start: 1, duration: 6 });
    c.text = await add("add_text", { text: "Meet the all-new camera rig\nbuilt for creators", start: 0.5, duration: 4 });
    c.shape = await add("add_shape", { kind: "rounded_rectangle", start: 0, duration: 5, width: 0.4, height: 0.2, color: "#ff3d7f", stroke_width: 6, gradient: { from: "#ff3d7f", to: "#ff8a3d", angle: 0, kind: "radial" } });
    c.color = await add("add_color_clip", { color: "#204060", start: 11, duration: 3 });
    c.adjustment = await add("add_adjustment_clip", { start: 2, duration: 4 });
    c.sticker = await add("add_sticker", { name: "fire", start: 1, duration: 2 });
    c.caption = await add("add_captions", { captions: [{ start: 5, end: 7, text: "And this is the caption that runs rather long on purpose" }, { start: 7, end: 9, text: "second caption" }] });
    const inPic = await add("add_media_clip", { asset_id: pic.id, start: 14, duration: 2 });
    const inText = await add("add_text", { text: "Inside", start: 14, duration: 2 });
    c.compound = await add("create_compound_clip", { clip_ids: [inPic, inText], name: "Opening titles over the hero shot, compound version two" });
    c.green = await add("add_media_clip", { asset_id: green.id, start: 16, duration: 3 });
    const v = c.video;
    const steps = [
      ["set_transition", { clip_id: v, type: "dissolve", duration: 0.5 }],
      ["style_text_range", { clip_id: c.text, match: "all-new", color: "#ffcc00", weight: 800 }],
      ["set_text", { clip_id: c.text, style: { stroke: { color: "#000000", width: 6 }, stroke2: { color: "#ffffff", width: 10 }, glow: { color: "#00e5ff", blur: 24 }, gradient: { from: "#ffffff", to: "#ff3d7f", angle: 0 }, shadow: { color: "#000000aa", blur: 12, x: 4, y: 6 }, background: { color: "#000000cc", padding: 16, radius: 8 } } }],
      ["set_text", { clip_id: c.caption, style: { highlight: "#ffe14d" } }],
      ["set_animation", { clip_id: c.text, slot: "in", type: "wordPop", duration: 0.6 }],
      ["set_animation", { clip_id: c.image, slot: "loop", type: "pulse" }],
      ["add_keyframe", { clip_id: v, path: "transform.x", at: 0, value: -0.1, ease: "easeInOut" }],
      ["add_keyframe", { clip_id: v, path: "transform.x", at: 2, value: 0.1 }],
      ["add_keyframe", { clip_id: v, path: "opacity", at: 0, value: 1 }],
      ["add_effect", { clip_id: v, type: "rgbSplit" }],
      ["add_effect", { clip_id: v, type: "letterbox" }],
      ["add_effect", { clip_id: v, type: "kaleidoscope" }],
      ["add_effect", { clip_id: c.image, type: "mirror" }],
      ["add_effect", { clip_id: c.image, type: "zoomPulse", params: { rate: 0.25 } }],
      ["set_filter", { clip_id: v, type: "cinematic", intensity: 0.8 }],
      ["apply_lut", { clip_id: v, lut_id: api.project().luts[0].id }],
      ["set_hsl", { clip_id: v, band: "red", hue: 10 }],
      ["set_curve", { clip_id: v, channel: "luma", points: [[0, 0], [0.5, 0.6], [1, 1]] }],
      ["set_color_wheel", { clip_id: v, wheel: "gamma", r: 0.1, g: 0, b: -0.1 }],
      ["set_compressor", { clip_ids: [v, c.voiceover], preset: "voice" }],
      ["set_audio_filter", { clip_ids: [c.audio], type: "lowpass", cutoff: 800 }],
      ["set_audio_filter", { clip_ids: [c.audio], type: "highpass", cutoff: 120 }],
      ["set_reverb", { clip_ids: [c.audio], preset: "cathedral" }],
      ["set_echo", { clip_ids: [c.audio] }],
      ["set_tape_stop", { clip_ids: [c.audio] }],
      ["set_canvas_fill", { clip_ids: [c.image], fill: "color", color: "#112233" }],
      ["set_mask", { clip_ids: [c.image], shape: "rectangle" }],
      ["set_shadow", { clip_ids: [c.image] }],
      ["set_motion_blur", { clip_ids: [c.image], on: true }],
      ["set_chroma_key", { clip_ids: [c.green], enabled: true }],
      ["set_speed_curve", { clip_id: c.curve, preset: "montage" }],
      ["set_brand", { primary: "#2563eb", heading_font: "Inter" }],
      ["add_track", { kind: "video", name: "B-roll and cutaways for the second half of the interview" }],
    ];
    for (const [name, args] of steps) api.exec(name, args);
    return {
      clips: c,
      // A speed curve and a chroma key only add to those tabs.
      only: { curve: ["Speed"], green: ["Video"] },
      multi: { two: [c.video, c.image], three: [c.text, c.shape, c.sticker], mixed: [c.video, c.audio, c.voiceover, c.text] },
    };
  });

  // ---- the audit -----------------------------------------------------------
  const audit = (label) =>
    page.evaluate((label) => {
      const faults = [];
      const css = (e) => getComputedStyle(e);
      const shown = (e) => {
        for (let x = e; x && x !== document.documentElement; x = x.parentElement) {
          const s = css(x);
          if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) < 0.05) return false;
        }
        return true;
      };
      const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      const cut = (r, b) => ({ left: Math.max(r.left, b.left), top: Math.max(r.top, b.top), right: Math.min(r.right, b.right), bottom: Math.min(r.bottom, b.bottom) });
      const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
      // What an element's ancestors let show: `all` cut by every clipping
      // ancestor, `fixed` by non-scrolling ones only (null past a scroller,
      // whose content can be scrolled to).
      const clipMemo = new Map();
      const clipFor = (e) => {
        if (!e || e === document.body || e === document.documentElement) return { all: view, fixed: view };
        if (clipMemo.has(e)) return clipMemo.get(e);
        const s = css(e);
        let c = s.position === "fixed" ? { all: view, fixed: view } : clipFor(e.parentElement);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") {
          const b = e.getBoundingClientRect();
          const scroller = /(auto|scroll)/.test(s.overflowX + s.overflowY);
          c = { all: cut(c.all, b), fixed: scroller || !c.fixed ? null : cut(c.fixed, b) };
        }
        clipMemo.set(e, c);
        return c;
      };
      const name = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      const where = (el) => `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : ""} "${name(el)}"`;
      const add = (kind, el, extra = {}) => faults.push({ state: label, kind, el: el ? where(el) : "", ...extra });
      const measure = document.createElement("canvas").getContext("2d");
      const textWidth = (text, s) => ((measure.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`), measure.measureText(text).width);

      if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) add("page-scroll", null, { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight });
      const panel = document.querySelector("section[aria-label=Inspector]");
      const body = panel?.querySelector(".insp-body");
      if (body && body.scrollWidth > body.clientWidth + 1) {
        const edge = body.getBoundingClientRect().left + body.clientWidth;
        const past = [...body.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > edge + 1);
        add("side-scroll", body, { scroll: body.scrollWidth, client: body.clientWidth, past: past.filter((e) => !past.some((o) => o !== e && e.contains(o))).slice(0, 3).map(where) });
      }
      const tabs = panel?.querySelector(".insp-tabs");
      if (tabs && tabs.scrollWidth > tabs.clientWidth + 1) add("tabs-hidden", tabs, { scroll: tabs.scrollWidth, client: tabs.clientWidth });
      // Wide inspectors: a plain row's control starts where the sliders do.
      if (panel && panel.clientWidth >= 340)
        for (const sec of panel.querySelectorAll(".insp-section-body")) {
          const xs = [...sec.querySelectorAll(":scope > .insp-row > .insp-slider, :scope > * > .insp-row > .insp-slider")].map((e) => Math.round(e.getBoundingClientRect().left));
          for (const row of sec.querySelectorAll(".insp-row.plain")) {
            const [l, c] = [row.querySelector(".insp-label"), row.querySelector(".insp-control")].map((e) => e.getBoundingClientRect());
            if (xs.length && Math.abs(l.top - c.top) < 12 && Math.abs(c.left - xs[0]) > 1) add("misaligned", row, { control: Math.round(c.left), slider: xs[0] });
          }
        }
      const roots = [...document.querySelectorAll("section[aria-label=Inspector], .ease-menu, dialog[open], .kf-panel, .scopes-panel")];
      for (const root of roots) {
        if (!shown(root)) continue;
        const rr = root.getBoundingClientRect();
        if (root.matches(".ease-menu, dialog[open]") && (rr.left < -0.5 || rr.top < -0.5 || rr.right > innerWidth + 0.5 || rr.bottom > innerHeight + 0.5)) add("popover-off-screen", root, { rect: [rr.left, rr.top, rr.right, rr.bottom].map(Math.round) });
        const controls = [];
        for (const el of root.querySelectorAll("*")) {
          if (!shown(el)) continue;
          const r = el.getBoundingClientRect();
          if (area(r) <= 0) continue;
          const s = css(el);
          const c = clipFor(el.parentElement);
          const seen = cut(r, c.all);
          if (area(seen) <= 0) continue;
          const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (ownText && /(hidden|clip)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) {
            if (s.textOverflow !== "ellipsis") add("clipped-text", el, { scroll: el.scrollWidth, client: el.clientWidth });
            else if (!el.closest("[data-tip]")) add("ellipsis-no-tip", el, { scroll: el.scrollWidth, client: el.clientWidth });
          }
          if (ownText && c.fixed && (r.right > c.fixed.right + 1 || r.left < c.fixed.left - 1)) add("clipped-text", el, { rect: [r.left, r.right].map(Math.round), clip: [c.fixed.left, c.fixed.right].map(Math.round) });
          if (el.matches("button, [role=tab], label, .btn, .chip-btn") && el.scrollWidth > el.clientWidth + 2 && s.overflowX === "visible") add("text-spills", el, { scroll: el.scrollWidth, client: el.clientWidth });
          if (el.matches(".btn, .chip-btn, .segmented button, [role=tab], .curve-ch") && !el.matches(".layout-tile") && ownText) {
            const tops = new Set();
            for (const n of el.childNodes) {
              if (n.nodeType !== 3 || !n.textContent.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(n);
              for (const q of range.getClientRects()) if (q.width > 0.5) tops.add(Math.round(q.top));
            }
            if (tops.size > 1) add("wrapped-button", el, { lines: tops.size });
          }
          if (el.matches("button, input, select, textarea")) {
            controls.push([el, seen]);
            if (c.fixed && (r.left < c.fixed.left - 1 || r.right > c.fixed.right + 1 || r.top < c.fixed.top - 1 || r.bottom > c.fixed.bottom + 1)) add("cut-off", el, { rect: [r.left, r.top, r.right, r.bottom].map(Math.round), clip: [c.fixed.left, c.fixed.top, c.fixed.right, c.fixed.bottom].map(Math.round) });
          }
          if (el.matches("input[type=range]") && r.width < 56) add("squeezed-slider", el, { w: Math.round(r.width) });
          if ((el.matches(".toggle") && r.width < 29) || (el.matches("input[type=color]") && r.width < 24) || (el.matches(".icon-btn, .key-toggle") && r.width < 18)) add("squeezed-control", el, { w: Math.round(r.width) });
          if (el.matches("input.num, .insp-num input") && el.value) {
            const room = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
            if (textWidth(el.value, s) > room + 0.5) add("value-clipped", el, { value: el.value, room: Math.round(room) });
          }
          if (el.matches("select")) {
            const text = el.selectedOptions[0]?.textContent ?? "";
            // The text's room: the box less its padding and the arrow.
            const room = el.clientWidth - parseFloat(s.paddingLeft) - Math.max(parseFloat(s.paddingRight), 20);
            // A long name may end in an ellipsis when the select tips it.
            if (textWidth(text, s) > room + 1 && !(s.textOverflow === "ellipsis" && el.closest("[data-tip]"))) add("select-clipped", el, { text: text.slice(0, 40), room: Math.round(room) });
          }
        }
        for (let i = 0; i < controls.length; i++)
          for (let j = i + 1; j < controls.length; j++) {
            const [a, p] = controls[i], [b, q] = controls[j];
            if (a.contains(b) || b.contains(a)) continue;
            const w = Math.min(p.right, q.right) - Math.max(p.left, q.left), h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
            if (w > 1 && h > 1) add("overlap", a, { with: where(b), w: Math.round(w), h: Math.round(h) });
          }
      }
      return faults;
    }, label);

  const details = {};
  const faultsBy = new Map();
  let states = 0;
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const look = async (group, label) => {
    await settle();
    states++;
    const f = await audit(label);
    if (!faultsBy.has(group)) faultsBy.set(group, []);
    faultsBy.get(group).push(...f);
  };
  const insp = page.locator("section[aria-label=Inspector]");
  const select = (sel) => page.evaluate((s) => window.videoEditor.select(s), sel);
  const openAll = async () => {
    for (let i = 0; i < 40; i++) {
      const closed = insp.locator(".insp-section-toggle[aria-expanded=false]");
      if (!(await closed.count())) return;
      await closed.first().click();
    }
  };
  // The splitter left of the inspector: dragged left it widens the
  // inspector (to 560 px, or what the window leaves), right narrows it
  // (to 260 px); a double-click restores the default share.
  const setWidth = async (mode) => {
    const sp = page.locator(".top-row > .splitter-x").last();
    if (mode === "default") await sp.dblclick();
    else {
      const b = await sp.boundingBox();
      const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) await page.mouse.move(x + ((mode === "max" ? -900 : 900) * i) / 6, y);
      await page.mouse.up();
    }
    await settle();
    return Math.round((await insp.boundingBox()).width);
  };
  // Every clip's every tab and sub-tab with all sections open, the
  // project's details and the multi-selections.
  const walk = async (group, at) => {
    await select([]);
    await openAll();
    await look(group, `${at} project`);
    for (const [kind, id] of Object.entries(ids.clips)) {
      await select([id]);
      for (const tab of await insp.getByRole("tab").allTextContents()) {
        if (ids.only[kind] && !ids.only[kind].some((t) => tab.startsWith(t))) continue;
        await insp.getByRole("tab", { name: tab, exact: true }).click();
        const subs = await insp.locator(".insp-sub .segmented button").allTextContents();
        for (const sub of subs.length ? subs : [null]) {
          if (sub) await insp.locator(".insp-sub .segmented button", { hasText: sub }).first().click();
          await openAll();
          await look(group, `${at} ${kind} ${tab}${sub ? ` ${sub}` : ""}`);
        }
      }
    }
    for (const [name, sel] of Object.entries(ids.multi)) {
      await select(sel);
      await openAll();
      await look(group, `${at} ${name} clips`);
    }
  };

  // A number shows the decimals its step moves by: Letterbox's 2.39:1
  // read 2.4, and Zoom pulse's 0.25/s 0.3.
  await select([ids.clips.video]);
  await insp.getByRole("tab", { name: /^Effects/ }).click();
  const ratio = await insp.getByRole("textbox", { name: "Ratio value" }).inputValue();
  await select([ids.clips.image]);
  await insp.getByRole("tab", { name: /^Effects/ }).click();
  const rate = await insp.getByRole("textbox", { name: "Rate value" }).inputValue();
  details.decimals = { ok: ratio === "2.39" && rate === "0.25", ratio, rate };

  const walked = new Set();
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    const at = `${w}x${h}`;
    const widths = {};
    for (const mode of ["max", "min", "default"]) {
      const iw = await setWidth(mode);
      widths[mode] = iw;
      // A width already walked (the splitter stops at 260 and 560 at
      // most sizes) is only checked on its first state.
      if (walked.has(iw)) {
        await select([ids.clips.video]);
        await look(at, `${at} ${mode} ${iw} video`);
        continue;
      }
      walked.add(iw);
      await walk(at, `${at} ${mode} ${iw}`);
    }

    // Popovers and dialogs at the default width.
    await select([ids.clips.video]);
    await insp.getByRole("tab", { name: "Video", exact: true }).click();
    await insp.locator(".insp-sub .segmented button", { hasText: "Basic" }).first().click();
    await page.evaluate(() => window.videoEditor.seek(0));
    const ease = insp.locator("button.key-ease").first();
    await ease.scrollIntoViewIfNeeded();
    await ease.click();
    await page.locator(".ease-menu").waitFor();
    await look(at, `${at} easing menu`);
    const placed = await page.evaluate(() => {
      const m = document.querySelector(".ease-menu").getBoundingClientRect();
      const b = document.querySelector("section[aria-label=Inspector] button.key-ease").getBoundingClientRect();
      const room = innerHeight - b.bottom - 10 >= m.height || b.top - 10 >= m.height;
      const covers = m.top < b.bottom && m.bottom > b.top && m.left < b.right && m.right > b.left;
      return { room, covers, menu: [m.top, m.bottom].map(Math.round), button: [b.top, b.bottom].map(Math.round) };
    });
    if (placed.room && placed.covers) (faultsBy.get(at) ?? faultsBy.set(at, []).get(at)).push({ state: `${at} easing menu`, kind: "covers-button", ...placed });
    await page.keyboard.press("Escape");
    await insp.getByRole("tab", { name: /^Effects/ }).click();
    await insp.getByRole("button", { name: "Add effect" }).click();
    await look(at, `${at} effect picker`);
    await insp.getByRole("button", { name: "Effect presets…" }).click();
    await page.locator("dialog[open]").waitFor();
    await look(at, `${at} effect presets`);
    await page.keyboard.press("Escape");
    await insp.getByRole("button", { name: "Copy attributes" }).click();
    await select(ids.multi.mixed);
    await insp.getByRole("button", { name: "Paste attributes…" }).click();
    await page.locator("dialog[open]").waitFor();
    await look(at, `${at} paste attributes`);
    await page.keyboard.press("Escape");
    await select([ids.clips.text]);
    await insp.getByRole("tab", { name: "Text", exact: true }).click();
    const save = insp.getByRole("button", { name: "Save this style" });
    if (await save.count()) {
      await save.click();
      await insp.getByRole("textbox", { name: "Style name" }).fill(`Bold yellow lower third for interviews ${w}`);
      await look(at, `${at} naming a style`);
      await insp.getByRole("button", { name: "Save", exact: true }).click();
      await look(at, `${at} saved style`);
    }
    await page.screenshot({ path: `${shots}/${at}-text.png` });

    // The keyframe panel under the timeline: lanes, empty, quick-add.
    await select([ids.clips.video]);
    await page.evaluate(() => window.videoEditor.action("toggleKeyframePanel"));
    await page.locator(".kf-panel").waitFor();
    await look(at, `${at} keyframe lanes`);
    await page.screenshot({ path: `${shots}/${at}-keyframes.png` });
    await select([]);
    await look(at, `${at} keyframe panel empty`);
    await select([ids.clips.image]);
    await look(at, `${at} keyframe quick add`);
    await page.evaluate(() => window.videoEditor.action("toggleKeyframePanel"));
    // The scopes in the library's place.
    await page.getByRole("button", { name: "Scopes", exact: true }).first().click();
    await page.locator(".scopes-panel").waitFor();
    await look(at, `${at} scopes`);
    await page.screenshot({ path: `${shots}/${at}-scopes.png` });
    await page.getByRole("button", { name: "Close scopes" }).click();

    // Beside the docked AI assistant.
    await page.locator(".assistant-btn").click();
    await page.locator("aside.assistant").waitFor();
    await settle();
    const iw = Math.round((await insp.boundingBox()).width);
    widths.assistant = iw;
    if (walked.has(iw)) {
      await select([ids.clips.text]);
      await look(at, `${at} assistant ${iw} text`);
    } else {
      walked.add(iw);
      await walk(at, `${at} assistant ${iw}`);
    }
    await select([ids.clips.video]);
    await page.screenshot({ path: `${shots}/${at}-assistant.png` });
    await page.locator(".assistant-btn").click();
    await setWidth("default");

    const list = faultsBy.get(at) ?? [];
    const kinds = {};
    for (const f of list) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
    details[at] = { ok: list.length === 0, widths, kinds, faults: list.slice(0, 12) };
  }
  details.coverage = { ok: states > 500, states, widths: [...walked].sort((a, b) => a - b) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
