// Styling sweep: opens every library tab, inspector tab, menu, dialog and
// the AI assistant's column at three window sizes and checks each state
// for layout faults a screenshot review misses: page scroll, clipped
// text, text spilling out of controls, controls overlapping, controls cut
// off by a non-scrolling parent, unlabeled controls and low text
// contrast. Passes when no state has a fault; screenshots go to
// scratch/style/ for a look by eye.
async (page) => {
  const sizes = [
    [1600, 950],
    [1280, 720],
    [1100, 680], // the desktop window's minimum (tauri.conf.json)
  ];
  const audit = (label) =>
    page.evaluate((label) => {
      const faults = [];
      const style = new Map();
      const css = (e) => style.get(e) ?? (style.set(e, getComputedStyle(e)), style.get(e));
      // Shown: no hidden, undisplayed or transparent ancestor (memoized
      // per element, so the walk is linear).
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
      // What an element's ancestors let show of its children: `all` cuts by
      // every clipping ancestor, `fixed` only by non-scrolling ones (null
      // past a scroller: what it hides can be scrolled into view). A
      // fixed-position element starts over from the window.
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
      const seen = (el) => cut(el.getBoundingClientRect(), parentClip(el).all);
      const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 40);
      const where = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} "${name(el)}"`;
      const add = (kind, el, extra = {}) => faults.push({ state: label, kind, el: where(el), ...extra });
      if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1)
        faults.push({ state: label, kind: "page-scroll", w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight });
      const all = [...document.querySelectorAll("body *")].filter((el) => shown(el) && area(seen(el)) > 0);
      const controls = all.filter((el) => el.matches("button, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], input, select, textarea, a[href]"));
      const bgMemo = new Map();
      const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      // The first opaque background behind an element; null over a gradient
      // or image, where contrast cannot be read from one color.
      const bgOf = (e) => {
        if (!e) return [0, 0, 0];
        if (bgMemo.has(e)) return bgMemo.get(e);
        const s = css(e);
        const c = rgb(s.backgroundColor);
        const v = s.backgroundImage !== "none" ? null : c.length && (c[3] ?? 1) > 0.9 ? c : bgOf(e.parentElement);
        bgMemo.set(e, v);
        return v;
      };
      const lum = ([r, g, b]) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      for (const el of all) {
        const cs = css(el);
        const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        // Text cut off without an ellipsis to say so.
        if (ownText && /(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1)
          add("clipped-text", el, { scroll: el.scrollWidth, client: el.clientWidth });
        // Text whose box runs past a non-scrolling parent that clips it
        // (an ellipsis on the text itself would say so instead).
        const pc = ownText ? parentClip(el).fixed : null;
        const tr = el.getBoundingClientRect();
        if (pc && (tr.right > pc.right + 1 || tr.left < pc.left - 1) && area(cut(tr, pc)) > 0)
          add("clipped-text", el, { rect: [tr.left, tr.right].map(Math.round), clip: [pc.left, pc.right].map(Math.round) });
        // Text running past a control's own box.
        if (el.matches("button, [role=tab], [role=menuitem], label") && el.scrollWidth > el.clientWidth + 2 && cs.overflowX === "visible")
          add("text-spills", el, { scroll: el.scrollWidth, client: el.clientWidth });
        if (ownText && !el.closest("[disabled], [aria-disabled=true], .disabled")) {
          const [fr, fg, fb, fa = 1] = rgb(cs.color);
          const bg = bgOf(el);
          if (bg && fa > 0.9) {
            const [a, b] = [lum([fr, fg, fb]), lum(bg)].sort((x, y) => y - x);
            const ratio = (a + 0.05) / (b + 0.05);
            const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700);
            if (ratio < (big ? 3 : 4.5)) add("low-contrast", el, { ratio: Math.round(ratio * 100) / 100, color: cs.color, bg: `rgb(${bg.slice(0, 3).join(",")})`, size: cs.fontSize });
          }
        }
      }
      const seenOf = new Map();
      for (const el of controls) {
        seenOf.set(el, seen(el));
        const r = el.getBoundingClientRect();
        const labelled = name(el) || el.getAttribute("aria-labelledby") || el.getAttribute("placeholder") || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest("label") || el.getAttribute("data-tip");
        if (!labelled && el.type !== "hidden") add("no-name", el, { html: el.outerHTML.slice(0, 160), parent: el.parentElement?.outerHTML.slice(0, 200) });
        const c = parentClip(el).fixed;
        if (c && (r.left < c.left - 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.bottom > c.bottom + 1))
          add("cut-off", el, { rect: [r.left, r.top, r.right, r.bottom].map(Math.round), clip: [c.left, c.top, c.right, c.bottom].map(Math.round) });
      }
      // A popup's controls cover the app's: a menu, or a modal <dialog>.
      const popup = (el) => !!el.closest(".menu, dialog, [role=dialog], .ctx-anchor");
      for (let i = 0; i < controls.length; i++)
        for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i], b = controls[j];
          if (a.contains(b) || b.contains(a) || popup(a) !== popup(b)) continue;
          const p = seenOf.get(a), q = seenOf.get(b);
          const w = Math.min(p.right, q.right) - Math.max(p.left, q.left), h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
          if (w > 2 && h > 2) add("overlap", a, { with: where(b), w: Math.round(w), h: Math.round(h) });
        }
      return faults;
    }, label);

  const faults = [];
  const shots = [];
  const errors = [];
  // A state: do `fn`, wait out the 180 ms pop-in animations, audit and
  // capture, then close it with Escape when it opened a menu or dialog
  // (Escape on the editor clears the selection, which tabs need).
  const step = async (label, fn, close = false) => {
    try {
      await fn();
      await page.waitForTimeout(300);
      faults.push(...(await audit(label)));
      const vp = page.viewportSize();
      const file = `__REPO__/scratch/style/${vp.width}x${vp.height}-${label.replace(/[^\w-]+/g, "_")}.png`;
      await page.screenshot({ path: file });
      shots.push(file);
    } catch (e) {
      errors.push({ label, error: String(e).split("\n")[0].slice(0, 200) });
    }
    if (close) await page.keyboard.press("Escape").catch(() => {});
  };
  page.setDefaultTimeout(5000);
  // The AI assistant lists the models installed on this computer: answer
  // for Ollama before its panel opens, so no real model's name is captured.
  await page.context().route("http://127.0.0.1:11434/api/tags", (r) =>
    r.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llama3.1:8b" }] }) }),
  );
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await page.waitForFunction(() => !!window.videoEditor);
    const v = `${width}`;
    await step(`${v}-home`, async () => {});
    await page.locator(".create-card").first().click();
    await page.locator(".timeline-panel").waitFor();
    await step(`${v}-empty`, async () => {});
    const ids = await page.evaluate(async () => {
      const api = window.videoEditor;
      const o = location.origin + "/fixtures/media/";
      const [vid, pic, voice] = await api.import([
        { name: "talk-gaps.mp4", src: o + "talk-gaps.mp4" },
        { name: "photo.jpg", src: o + "photo.jpg" },
        { name: "voice-8s.wav", src: o + "voice-8s.wav" },
      ]);
      api.exec("add_media_clip", { asset_id: vid.id, start: 0, duration: 4 });
      api.exec("add_media_clip", { asset_id: pic.id, start: 4, duration: 3 });
      api.exec("add_media_clip", { asset_id: voice.id, start: 0, duration: 5 });
      api.exec("add_text", { text: "Sweep title", start: 1, duration: 3 });
      const clips = api.project().tracks.flatMap((t) => t.clips);
      const by = (t) => clips.find((c) => c.type === t)?.id;
      return { video: by("video"), image: by("image"), audio: by("audio"), text: by("text") };
    });
    await page.evaluate(() => window.videoEditor.select([]));
    const lib = page.getByRole("region", { name: "Library" });
    for (const tab of await lib.getByRole("tab").allTextContents())
      await step(`${v}-lib-${tab}`, () => lib.getByRole("tab", { name: tab, exact: true }).click());
    const insp = page.getByRole("region", { name: "Inspector" });
    for (const kind of ["video", "image", "audio", "text"]) {
      await page.evaluate((id) => window.videoEditor.select([id]), ids[kind]);
      await page.waitForTimeout(100);
      for (const tab of await insp.getByRole("tab").allTextContents())
        await step(`${v}-insp-${kind}-${tab}`, () => insp.getByRole("tab", { name: tab, exact: true }).click());
    }
    await page.evaluate((ids) => window.videoEditor.select([ids.video, ids.image, ids.audio]), ids);
    await step(`${v}-insp-multi`, async () => {});
    await page.evaluate((id) => window.videoEditor.select([id]), ids.video);
    for (const m of await page.locator(".menubar-item > button").allTextContents())
      await step(`${v}-menu-${m}`, () => page.locator(".menubar-item > button", { hasText: m }).first().click(), true);
    await step(`${v}-mixer`, () => page.getByRole("button", { name: "Mixer", exact: true }).click());
    await page.getByRole("button", { name: "Close mixer", exact: true }).click();
    await step(`${v}-timeline-display`, () => page.getByRole("button", { name: "Timeline display", exact: true }).click(), true);
    await step(`${v}-clip-menu`, () => page.locator(`[data-clip="${ids.video}"]`).first().click({ button: "right" }), true);
    await step(`${v}-track-menu`, () => page.locator(".tl-header").first().click({ button: "right" }), true);
    await step(`${v}-media-menu`, async () => {
      await lib.getByRole("tab", { name: "Media", exact: true }).click();
      await page.locator(".media-card").first().click({ button: "right" });
    }, true);
    await step(`${v}-export`, () => page.locator(".export-btn").click(), true);
    const menuItem = async (menu, item) => {
      await page.locator(".menubar-item > button", { hasText: menu }).first().click();
      await page.getByRole("menuitem", { name: item }).first().click();
    };
    await step(`${v}-prefs`, () => menuItem("Edit", /Preferences/), true);
    await step(`${v}-shortcuts`, () => menuItem("Help", /shortcuts/i), true);
    await step(`${v}-save-copy`, () => menuItem("File", /Save a copy/), true);
    await step(`${v}-manage-media`, async () => {
      await lib.getByRole("tab", { name: "Media", exact: true }).click();
      await page.locator(".media-clear", { hasText: "Manage media" }).click();
    }, true);
    await step(`${v}-source`, () => page.locator(".media-card").first().dblclick(), true);
    // The AI assistant docked beside the editor (ADR-064), both its views.
    await step(`${v}-assistant`, async () => {
      await page.locator(".assistant-btn").click();
      await page.locator(".assistant-status", { hasText: "Ready" }).waitFor();
    });
    await step(`${v}-assistant-agents`, () => page.getByRole("tab", { name: "Connect agents" }).click());
    await page.locator(".assistant-btn").click().catch(() => {});
  }
  const by = {};
  for (const f of faults) (by[f.kind] ??= []).push(f);
  const details = Object.fromEntries(Object.entries(by).map(([k, list]) => [k, { ok: false, count: list.length, list }]));
  details.steps = { ok: errors.length === 0, errors, shots: shots.length };
  return { ok: faults.length === 0 && errors.length === 0, details };
};
