// The library panel (every tab) at every window size: the desktop window's
// 1100 x 680 minimum up to 2560 x 1440, plus the web build's 1024 x 640 and
// 900 x 600, with the library splitter at its narrowest and widest, the top
// row at its shortest, and the AI assistant docked beside the editor (the
// library narrows or steps aside). The project is filled through
// window.videoEditor with long names, folders, favorites, captions and many
// markers; the empty states are seen first. Every state is audited inside
// the library and its popups for: the page scrolling; a scroller that
// scrolls sideways; text cut off without an ellipsis, or with one and no
// tooltip; text spilling out of a control; a button or tab whose words
// wrap; controls overlapping or cut off by a non-scrolling parent; a popup
// (menu, settings, voiceover panel, dialog) leaving the window; cards in one
// grid row whose names do not line up; controls with no name; tabs on more
// than two rows or unbalanced ones, icon tabs without a tooltip; and search
// boxes under 100 px. Then: a marker's cut note names itself in a tooltip
// (a whole one does not), and an opened marker editor is in view. Ollama is
// stubbed, so no installed model's name is captured. Screenshots of the
// library go to scratch/sizes-library/. SIZES=1100x680,1600x940 and
// EXTREMES=1100 (environment) narrow a run under run.mjs; all of it takes
// about four minutes.
async (page) => {
  page.setDefaultTimeout(6000);
  const base = "http://localhost:1420";
  const shots = "__REPO__/scratch/sizes-library";
  const env = typeof process === "object" ? process.env : {};
  const all = [[1100, 680], [1280, 720], [1366, 768], [1440, 900], [1600, 940], [1920, 1080], [2560, 1440], [1024, 640], [900, 600]];
  const sizes = env.SIZES ? env.SIZES.split(",").map((s) => s.split("x").map(Number)) : all;
  // The splitter extremes and the docked assistant, at these sizes.
  const extremes = env.EXTREMES ? env.EXTREMES.split(",").map(Number) : [1100, 1280, 1600, 2560, 900];
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await page.context().route("http://127.0.0.1:11434/**", (r) =>
    r.request().method() === "OPTIONS"
      ? r.fulfill({ status: 204, headers: cors })
      : r.fulfill({ headers: cors, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llama3.1:8b" }] }) }),
  );
  await page.context().route("**/api/tags", (r) => r.fulfill({ headers: cors, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llama3.1:8b" }] }) }));

  // ---- the audit: inside the library and the popups it opened ---------------
  const audit = (label) =>
    page.evaluate((label) => {
      const faults = [];
      const lib = document.querySelector("section[aria-label=Library]");
      // Popups the library opens: menus, the AI settings, the voiceover
      // panel and the dialogs (Manage media, marker export).
      const popups = [...document.querySelectorAll(".ctx-anchor .menu, .ai-pop, .vo-panel, dialog[open]")];
      const roots = [lib, ...popups].filter(Boolean);
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
      // What the ancestors let show: `all` by every clipping ancestor,
      // `fixed` by non-scrolling ones only (null past a scroller).
      const clipMemo = new Map();
      const clipFor = (e) => {
        if (!e || e === document.body || e === document.documentElement) return { all: view, fixed: view };
        if (clipMemo.has(e)) return clipMemo.get(e);
        const cs = css(e);
        let c = cs.position === "fixed" || e.matches("dialog[open]") ? { all: view, fixed: view } : clipFor(e.parentElement);
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
      const where = (el) => `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : ""} "${name(el)}"`;
      const add = (kind, el, extra = {}) => faults.push({ state: label, kind, el: where(el), ...extra });
      if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1)
        faults.push({ state: label, kind: "page-scroll", w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight });
      const els = roots.flatMap((r) => [r, ...r.querySelectorAll("*")]).filter((el) => shown(el) && area(seen(el)) > 0);
      const controls = els.filter((el) => el.matches("button, [role=button], [role=tab], [role=radio], [role=menuitem], [role=menuitemradio], input:not([type=hidden]), select, textarea, a[href]"));
      // data-cut: the panel names cut text in a tooltip as the pointer comes.
      const tipped = (el) => !!el.closest("[data-tip], [title], [data-cut]");
      const bgMemo = new Map();
      const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
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
      for (const el of els) {
        const cs = css(el);
        // A scroller that scrolls sideways: content wider than its panel.
        if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.tagName !== "SELECT" && el.tagName !== "TEXTAREA" && el.tagName !== "INPUT")
          add("side-scroll", el, { scroll: el.scrollWidth, client: el.clientWidth });
        const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (ownText && /(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
          if (cs.textOverflow !== "ellipsis" && cs.webkitLineClamp === "none") add("clipped-text", el, { scroll: el.scrollWidth, client: el.clientWidth });
          else if (!tipped(el)) add("ellipsis-no-tip", el, { scroll: el.scrollWidth, client: el.clientWidth });
        }
        if (ownText && cs.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 1 && !tipped(el)) add("ellipsis-no-tip", el, { lines: cs.webkitLineClamp });
        const pc = ownText ? parentClip(el).fixed : null;
        const tr = el.getBoundingClientRect();
        if (pc && (tr.right > pc.right + 1 || tr.left < pc.left - 1) && area(cut(tr, pc)) > 0)
          add("clipped-text", el, { rect: [tr.left, tr.right].map(Math.round), clip: [pc.left, pc.right].map(Math.round) });
        if (el.matches("button, [role=tab], [role=menuitem], label") && el.scrollWidth > el.clientWidth + 2 && cs.overflowX === "visible")
          add("text-spills", el, { scroll: el.scrollWidth, client: el.clientWidth });
        // A button's or tab's label on two lines.
        if (ownText && el.matches(".btn, [role=tab], [role=tab] *, [role=radio], .media-clear, .menu-item *")) {
          const tops = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).flatMap((n) => {
            const r = document.createRange();
            r.selectNodeContents(n);
            return [...r.getClientRects()].filter((q) => q.width > 1).map((q) => q.top);
          });
          if (tops.length && Math.max(...tops) - Math.min(...tops) > parseFloat(cs.fontSize) / 2) add("wrapped", el, { tops: tops.map(Math.round) });
        }
        if (ownText && !el.closest("[disabled], [aria-disabled=true], .disabled")) {
          const [fr, fg, fb, fa = 1] = rgb(cs.color);
          const bg = bgOf(el);
          if (bg && fa > 0.9) {
            const [a, b] = [lum([fr, fg, fb]), lum(bg)].sort((x, y) => y - x);
            const ratio = (a + 0.05) / (b + 0.05);
            const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700);
            if (ratio < (big ? 3 : 4.5)) add("low-contrast", el, { ratio: Math.round(ratio * 100) / 100, color: cs.color, bg: `rgb(${bg.slice(0, 3).join(",")})` });
          }
        }
      }
      const seenOf = new Map();
      for (const el of controls) {
        seenOf.set(el, seen(el));
        const r = el.getBoundingClientRect();
        const labelled = name(el) || el.getAttribute("aria-labelledby") || el.getAttribute("placeholder") || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest("label") || el.getAttribute("data-tip");
        if (!labelled) add("no-name", el, { html: el.outerHTML.slice(0, 160) });
        const c = parentClip(el).fixed;
        if (c && (r.left < c.left - 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.bottom > c.bottom + 1))
          add("cut-off", el, { rect: [r.left, r.top, r.right, r.bottom].map(Math.round), clip: [c.left, c.top, c.right, c.bottom].map(Math.round) });
      }
      const popup = (el) => popups.find((p) => p.contains(el)) ?? null;
      for (let i = 0; i < controls.length; i++)
        for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i], b = controls[j];
          if (a.contains(b) || b.contains(a) || popup(a) !== popup(b)) continue;
          const p = seenOf.get(a), q = seenOf.get(b);
          const w = Math.min(p.right, q.right) - Math.max(p.left, q.left), h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
          if (w > 2 && h > 2) add("overlap", a, { with: where(b), w: Math.round(w), h: Math.round(h) });
        }
      // Popups stay in the window (layout sizes: they scale in).
      for (const p of popups) {
        const r = p.getBoundingClientRect();
        if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) add("off-screen", p, { rect: [r.left, r.top, r.right, r.bottom].map(Math.round) });
      }
      // The tabs: at most two rows, balanced (no tab alone on a row), and
      // icons alone carry their name in a tooltip.
      const tabs = [...(lib?.querySelectorAll("[role=tab]") ?? [])];
      if (tabs.length) {
        const rows = new Map();
        for (const t of tabs) {
          const top = Math.round(t.getBoundingClientRect().top);
          rows.set(top, (rows.get(top) ?? 0) + 1);
        }
        const counts = [...rows.values()];
        if (counts.length > 2 || Math.max(...counts) - Math.min(...counts) > 1) faults.push({ state: label, kind: "tab-rows", rows: counts });
        for (const t of tabs) if (t.querySelector("span") && css(t.querySelector("span")).display === "none" && !t.dataset.tip) add("no-name", t, { why: "icon tab without a tooltip" });
      }
      // A search box wide enough to type in.
      for (const f of lib?.querySelectorAll(".lib-search .field") ?? []) {
        const w = f.getBoundingClientRect().width;
        if (shown(f) && w < 100) add("cramped", f, { width: Math.round(w) });
      }
      // Cards in one grid row: their names line up.
      for (const grid of lib?.querySelectorAll(".card-grid") ?? []) {
        const rows = new Map();
        for (const c of grid.children) {
          const t = Math.round(c.getBoundingClientRect().top);
          const l = c.querySelector(".card-label, .card-rename");
          if (l) (rows.get(t) ?? rows.set(t, []).get(t)).push(l.getBoundingClientRect().top);
        }
        for (const [t, tops] of rows) if (Math.max(...tops) - Math.min(...tops) > 1) add("misaligned", grid, { row: t, tops: tops.map(Math.round) });
      }
      return faults;
    }, label);

  const faults = [];
  const errors = [];
  const shotList = [];
  const tips = [];
  const step = async (label, fn, { close = false, shot = true } = {}) => {
    try {
      await fn();
      await page.waitForTimeout(300); // menus and cards animate in over 180 ms
      faults.push(...(await audit(label)));
      if (shot) {
        const box = await page.locator("section[aria-label=Library]").boundingBox().catch(() => null);
        const file = `${shots}/${label.replace(/[^\w-]+/g, "_")}.png`;
        await page.screenshot({ path: file, clip: box && !close ? box : undefined });
        shotList.push(file);
      }
    } catch (e) {
      errors.push({ label, error: String(e).split("\n")[0].slice(0, 200) });
    }
    if (close) await page.keyboard.press("Escape").catch(() => {});
  };
  const lib = page.locator("section[aria-label=Library]");
  const tab = (name) => lib.getByRole("tab", { name, exact: true }).click();
  // The splitters, dragged past their limits: the layout clamps them.
  const drag = async (sel, to) => {
    const b = await page.locator(sel).first().boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x ?? b.x + b.width / 2, to.y ?? b.y + b.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  };
  const libSplitter = ".top-row > .splitter-x";

  /** Every tab and its popups, at the current size and layout. */
  const tour = async (at, full) => {
    await tab("Media");
    await step(`${at}-media-grid`, async () => {
      await page.getByRole("button", { name: "Grid view", exact: true }).click();
    });
    if (full) {
      // The last card's menu, nearest the panel's (and window's) edge.
      await step(`${at}-media-menu`, () => page.locator(".media-card").last().click({ button: "right" }), { close: true });
      await step(`${at}-media-rename`, async () => {
        await page.locator(".media-card").first().click({ button: "right" });
        await page.getByRole("menuitem", { name: "Rename…" }).click();
      }, { close: true });
      await step(`${at}-record-menu`, () => page.getByRole("button", { name: "Record", exact: true }).click(), { close: true });
      await step(`${at}-media-hover`, () => page.locator(".media-card").nth(1).hover());
      // Manage media's folder editor, a long folder picked to rename.
      await step(`${at}-folders`, async () => {
        await page.getByRole("button", { name: "Manage media", exact: true }).click();
        await page.getByText("Organize folders", { exact: true }).click();
        await page.getByRole("combobox", { name: "Folder to manage" }).selectOption({ index: 1 });
      }, { close: true });
    }
    await step(`${at}-media-list`, () => page.getByRole("button", { name: "List view", exact: true }).click());
    await step(`${at}-media-nomatch`, () => page.getByRole("textbox", { name: "Search media" }).fill("no such file"));
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await page.getByRole("button", { name: "Grid view", exact: true }).click();
    await step(`${at}-audio`, () => tab("Audio"));
    await step(`${at}-audio-music`, () => page.getByRole("region", { name: "Generate music" }).scrollIntoViewIfNeeded());
    if (full) await step(`${at}-audio-sfx`, () => page.locator(".sfx-play").last().scrollIntoViewIfNeeded());
    for (const t of ["Text", "Effects", "Transitions", "Filters", "Adjustment"]) await step(`${at}-${t.toLowerCase()}`, () => tab(t));
    await step(`${at}-stickers`, () => tab("Stickers"));
    if (full) await step(`${at}-stickers-nomatch`, () => page.getByPlaceholder("Search stickers").fill("no such sticker"));
    await step(`${at}-captions`, () => tab("Captions"));
    if (full) await step(`${at}-captions-transcript`, () => page.locator(".transcript-card").scrollIntoViewIfNeeded());
    await step(`${at}-ai`, () => tab("AI tools"));
    await step(`${at}-ai-settings`, () => page.getByRole("button", { name: "Remove silences settings" }).click(), { close: true });
    if (full) await step(`${at}-ai-settings-last`, () => page.getByRole("button", { name: "Auto reframe settings" }).click(), { close: true });
    await step(`${at}-markers`, () => tab("Markers"));
    await step(`${at}-markers-edit`, () => page.locator(".marker-jump").nth(2).click());
    // The editor in view without scrolling by hand: its Save button, or in a
    // panel shorter than the editor, the editor's top.
    const save = await page.evaluate(() => {
      const b = document.querySelector(".marker-editor .btn.primary")?.getBoundingClientRect();
      const f = document.querySelector(".marker-editor")?.getBoundingClientRect();
      const t = document.querySelector(".markers-tab")?.getBoundingClientRect();
      if (!b || !f || !t) return { ok: false };
      const fits = b.top >= t.top - 0.5 && b.bottom <= t.bottom + 0.5;
      return { ok: fits || (f.height > t.height && f.top >= t.top - 0.5), b: [b.top, b.bottom].map(Math.round), tab: [t.top, t.bottom].map(Math.round) };
    });
    if (!save.ok) faults.push({ state: `${at}-markers-edit`, kind: "editor-hidden", ...save });
    if (full) {
      // Cut text names itself in a tooltip; text shown whole does not.
      for (const [what, el] of [["long", page.locator(".marker-note > span").nth(2)], ["short", page.locator(".marker-note > span").nth(1)]]) {
        await page.mouse.move(0, 0);
        await el.scrollIntoViewIfNeeded();
        await el.hover();
        await page.waitForTimeout(650); // the tooltip's 450 ms delay
        const t = await el.evaluate((s) => {
          const tip = document.querySelector(".tooltip.on");
          const r = tip?.getBoundingClientRect();
          return { cut: s.scrollWidth > s.clientWidth + 1, text: s.textContent, tip: tip?.textContent ?? null, inView: !r || (r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight) };
        });
        tips.push({ at, what, ...t });
        if ((t.cut ? t.tip !== t.text : t.tip !== null) || !t.inView) faults.push({ state: `${at}-markers-tip-${what}`, kind: "tooltip", ...t });
      }
      await page.mouse.move(0, 0);
    }
    // Close the editor, so the next layout's tour opens it afresh.
    await page.locator(".marker-actions .btn.ghost").click().catch(() => {});
    if (full) await step(`${at}-voiceover`, () => page.getByRole("button", { name: "Record voiceover" }).click(), { close: true });
  };

  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(base);
    await page.evaluate(() => localStorage.removeItem("layout"));
    await page.goto(base);
    await page.waitForFunction(() => !!window.videoEditor);
    await page.locator(".create-card").first().click();
    await page.locator(".timeline-panel").waitFor();
    const at = `${w}x${h}`;
    // The empty states first: nothing imported, nothing on the timeline.
    if (w === 1100 || w === 1920 || w === 900) {
      await step(`${at}-empty-media`, () => tab("Media"));
      await step(`${at}-empty-audio`, () => tab("Audio"));
      await step(`${at}-empty-captions`, () => tab("Captions"));
      await step(`${at}-empty-ai`, () => tab("AI tools"));
      await step(`${at}-empty-markers`, () => tab("Markers"));
    }
    await page.evaluate(async () => {
      const api = window.videoEditor;
      const o = location.origin + "/fixtures/media/";
      const files = [
        ["Interview with the director, final take 03 (color graded, v2).mp4", "talk-gaps.mp4"],
        ["B-roll_city_skyline_sunset_drone_4K_HDR_export_final_FINAL_for_review.mp4", "h264-1080p30.mp4"],
        ["photo.jpg", "photo.jpg"],
        ["Supercalifragilisticexpialidocious_background_music_track_master.mp3", "music-30s.mp3"],
        ["voice-8s.wav", "voice-8s.wav"],
        ["a.png", "color-bars.png"],
        ["Animated logo sting with a very long descriptive name.gif", "animated.gif"],
        ["scene-cuts.mp4", "scene-cuts.mp4"],
        ["portrait phone clip rotated.mp4", "phone-portrait-rotated.mp4"],
        ["beat-128.m4a", "beat-128.m4a"],
        ["Room tone recorded on location for the second interview day.wav", "speech-test.wav"],
        ["shaky.mp4", "shaky.mp4"],
      ];
      const assets = await api.import(files.map(([name, f]) => ({ name, src: o + f })));
      const long = "Interviews and talking heads from the first shooting day";
      api.exec("edit_media_folder", { action: "create", name: long });
      api.exec("edit_media_folder", { action: "create", name: "B-roll" });
      api.exec("organize_media", { asset_ids: [assets[0].id], folder: long, favorite: true });
      api.exec("organize_media", { asset_ids: [assets[1].id, assets[7].id], folder: "B-roll" });
      api.exec("organize_media", { asset_ids: [assets[5].id], favorite: true });
      api.exec("add_media_clip", { asset_id: assets[0].id, start: 0, duration: 4 });
      api.exec("add_media_clip", { asset_id: assets[3].id, start: 0, duration: 8 });
      api.exec("add_captions", { captions: [{ start: 0, end: 1.5, text: "Hello and welcome" }, { start: 1.5, end: 3, text: "to the caption test with a long line" }] });
      for (let i = 0; i < 14; i++)
        api.exec("add_marker", { at: i * 0.7, label: i === 2 ? "A very long marker note that goes on and on, to see how its row cuts the text" : `Marker ${i + 1}`, color: ["#3be0f0", "#ff6b75", "#ffc45c"][i % 3] });
      api.select([api.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "video").id]);
    });
    await page.waitForTimeout(500);
    await tour(at, true);

    if (extremes.includes(w)) {
      // The library at its narrowest, then its widest, then the top row at
      // its shortest; double-clicks put each back.
      await drag(libSplitter, { x: 0 });
      await tour(`${at}-libmin`, false);
      await drag(libSplitter, { x: w });
      await tour(`${at}-libmax`, false);
      await page.locator(libSplitter).first().dblclick();
      await drag(".workspace > .splitter-y", { y: 0 });
      await tour(`${at}-short`, false);
      await page.locator(".workspace > .splitter-y").first().dblclick();
      // The AI assistant docked: the library narrows (or steps aside).
      await page.locator(".assistant-btn").click();
      await page.locator("aside.assistant").waitFor();
      if (await lib.count()) await tour(`${at}-docked`, false);
      await page.locator(".assistant-btn").click();
    }
  }

  const by = {};
  for (const f of faults) (by[f.kind] ??= []).push(f);
  const details = Object.fromEntries(Object.entries(by).map(([k, list]) => [k, { ok: false, count: list.length, list }]));
  details.steps = { ok: errors.length === 0, errors, shots: shotList.length };
  details.tooltips = { ok: !by.tooltip, seen: tips };
  return { ok: faults.length === 0 && errors.length === 0, details };
};
