// The app shell at every window size: Home (grid and list, empty, search,
// Recently deleted, rename, the right-click menu), the title bar and its
// menus, the editor's grid with each splitter at its limits, every dialog
// (Export with its done view, Keyboard shortcuts while editing a chord),
// the tooltips at the window's edges and inside a modal dialog, and the AI
// assistant (chat, a long reply, Connect agents, its splitter; floating
// below 1066 px). Sizes run from the desktop window's 1100 x 680 minimum
// to 2560 x 1440, plus 1024 x 640 and 900 x 600 for the web build.
// In each state, inside the shell's own parts (the four panels' insides
// belong to their own sweeps): page scroll; panels overlapping or leaving
// the window; title-bar parts overlapping; a player under 456 px in a
// desktop-sized window; menus, tooltips and dialogs leaving the window; a
// tooltip under a modal dialog; text cut off without an ellipsis; text
// spilling out of a control; controls cut off or overlapping; sideways
// scrollbars; low contrast. Then the title bar of the desktop app (window
// buttons, IPC mocked) at its smallest sizes.
// Screenshots go to scratch/sizes-shell/. Ollama is stubbed with one
// generic model, so no installed model's name is captured.
async (page) => {
  page.setDefaultTimeout(6000);
  const base = "http://localhost:1420";
  const shotDir = "__REPO__/scratch/sizes-shell";
  const sizes = [
    [1100, 680], // the desktop window's minimum (tauri.conf.json)
    [1280, 720],
    [1366, 768],
    [1440, 900],
    [1600, 940], // the desktop window's default
    [1920, 1080],
    [2560, 1440],
    [1024, 640], // web only: below the desktop minimum
    [900, 600],
  ];
  const LONG = "Quarterly product launch film for the spring campaign, director's cut with the extended interview and alternate ending";
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
  const ollama = async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.url().endsWith("/api/tags")) return route.fulfill({ headers: cors, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llama3.1:8b" }] }) });
    if (req.url().endsWith("/api/chat")) {
      const reply = "Done. I added the title and a dissolve. " + "A reply long enough to wrap over many lines in the narrow column, with an unbroken path too: C:/Users/someone/Videos/an-extremely-long-folder-name-that-has-no-spaces-at-all/clip.mp4. ".repeat(2);
      return route.fulfill({ headers: cors, contentType: "application/json", body: JSON.stringify({ message: { role: "assistant", content: reply } }) }).catch(() => {});
    }
    return route.fulfill({ status: 404, headers: cors, body: "" });
  };
  await page.context().route("http://127.0.0.1:11434/**", ollama);
  await page.context().route("**/api/tags", (r) => r.fulfill({ headers: cors, contentType: "application/json", body: JSON.stringify({ models: [{ name: "llama3.1:8b" }] }) }));

  // ---- the audit -------------------------------------------------------------
  // `scope`: the shell's own parts, whose elements are checked one by one.
  const SCOPE = ".titlebar, .home, .menu, dialog, [role=dialog], .assistant, .export-scrim, .shortcuts-overlay, .drop-overlay";
  const audit = (label) =>
    page.evaluate(
      ({ label, SCOPE }) => {
        const faults = [];
        const style = new Map();
        const css = (e) => style.get(e) ?? (style.set(e, getComputedStyle(e)), style.get(e));
        const shownMemo = new Map();
        const shown = (e) => {
          if (!e || e === document.documentElement) return true;
          if (shownMemo.has(e)) return shownMemo.get(e);
          const cs = css(e);
          // Closed details lay out their children but paint only the summary.
          const folded = e.parentElement?.tagName === "DETAILS" && !e.parentElement.open && e.tagName !== "SUMMARY";
          const v = !folded && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) >= 0.05 && shown(e.parentElement);
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
        // A top-layer <dialog> starts over from the window too.
        const fresh = (el) => css(el).position === "fixed" || el.matches("dialog[open]");
        const parentClip = (el) => (fresh(el) ? { all: view, fixed: view } : clipFor(el.parentElement));
        const seen = (el) => cut(el.getBoundingClientRect(), parentClip(el).all);
        const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 40);
        const where = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} "${name(el)}"`;
        const add = (kind, el, extra = {}) => faults.push({ state: label, kind, el: el ? where(el) : "", ...extra });
        if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1)
          add("page-scroll", null, { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight });

        // The editor's grid: every panel inside the window, none on another.
        const panels = [...document.querySelectorAll(".workspace > .panel:not(.floating), .workspace > section, .top-row > section, .top-row > aside")].filter(shown);
        for (const [i, p] of panels.entries()) {
          const r = p.getBoundingClientRect();
          if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) add("panel-off-screen", p, { rect: [r.left, r.top, r.right, r.bottom].map(Math.round) });
          if (r.width < 40 || r.height < 40) add("panel-squeezed", p, { size: [r.width, r.height].map(Math.round) });
          for (const q of panels.slice(i + 1)) {
            const s = q.getBoundingClientRect();
            const w = Math.min(r.right, s.right) - Math.max(r.left, s.left), h = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
            if (w > 0.5 && h > 0.5) add("panel-overlap", p, { with: where(q), w: Math.round(w), h: Math.round(h) });
          }
        }
        // The title bar: menus, name, save state and buttons side by side.
        const bar = [...document.querySelectorAll(".titlebar-left > *, .titlebar-center > *, .titlebar-right > *")].filter(shown);
        for (const [i, a] of bar.entries())
          for (const b of bar.slice(i + 1)) {
            const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
            const w = Math.min(p.right, q.right) - Math.max(p.left, q.left);
            if (w > 0.5 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 0.5) add("titlebar-overlap", a, { with: where(b), w: Math.round(w) });
          }
        // The player keeps the width its transport needs (the dock module
        // measured 456 px) in every window the desktop app allows.
        const player = document.querySelector("section[aria-label=Player]");
        if (player && innerWidth >= 1100 && player.getBoundingClientRect().width < 455.5) add("player-squeezed", player, { width: Math.round(player.getBoundingClientRect().width) });
        // Popups stay inside the window.
        for (const el of document.querySelectorAll(".menu, .tooltip.on, dialog[open], [role=dialog], .export-dialog, .shortcuts-panel")) {
          if (!shown(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5)
            add("popup-off-screen", el, { rect: [r.left, r.top, r.right, r.bottom].map(Math.round), view: [innerWidth, innerHeight] });
        }
        // A tip shown is a tip seen: not under a modal dialog (top layer).
        const tipEl = document.querySelector(".tooltip.on");
        if (tipEl) {
          const r = tipEl.getBoundingClientRect();
          tipEl.style.pointerEvents = "auto"; // hit-testable for a moment
          const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
          tipEl.style.pointerEvents = "";
          if (!tipEl.contains(top)) add("tooltip-covered", tipEl, { by: top ? where(top) : null });
        }

        const all = [...document.querySelectorAll("body *")].filter((el) => el.closest(SCOPE) && shown(el) && area(seen(el)) > 0);
        const controls = all.filter((el) => el.matches("button, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=switch], input, select, textarea, a[href]"));
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
        for (const el of all) {
          const cs = css(el);
          const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (ownText && /(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1)
            add("clipped-text", el, { scroll: el.scrollWidth, client: el.clientWidth });
          const pc = ownText ? parentClip(el).fixed : null;
          const tr = el.getBoundingClientRect();
          if (pc && (tr.right > pc.right + 1 || tr.left < pc.left - 1) && area(cut(tr, pc)) > 0)
            add("clipped-text", el, { rect: [tr.left, tr.right].map(Math.round), clip: [pc.left, pc.right].map(Math.round) });
          if (el.matches("button, [role=tab], [role=menuitem], label") && el.scrollWidth > el.clientWidth + 2 && cs.overflowX === "visible")
            add("text-spills", el, { scroll: el.scrollWidth, client: el.clientWidth });
          // A sideways scrollbar nobody needs (a text field scrolls its own text).
          if (/(auto|scroll)/.test(cs.overflowX) && !el.matches("input, textarea, select") && el.scrollWidth > el.clientWidth + 1)
            add("sideways-scroll", el, { scroll: el.scrollWidth, client: el.clientWidth });
          if (ownText && !el.closest("[disabled], [aria-disabled=true], .disabled")) {
            const [fr, fg, fb, fa = 1] = rgb(cs.color);
            const bg = bgOf(el);
            if (bg && fa > 0.9) {
              const [a, b] = [lum([fr, fg, fb]), lum(bg)].sort((x, y) => y - x);
              const ratio = (a + 0.05) / (b + 0.05);
              const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700);
              if (ratio < (big ? 3 : 4.5)) add("low-contrast", el, { ratio: Math.round(ratio * 100) / 100, color: cs.color, size: cs.fontSize });
            }
          }
        }
        const seenOf = new Map();
        for (const el of controls) {
          seenOf.set(el, seen(el));
          const r = el.getBoundingClientRect();
          const labelled = name(el) || el.getAttribute("aria-labelledby") || el.getAttribute("placeholder") || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest("label") || el.getAttribute("data-tip");
          if (!labelled && el.type !== "hidden") add("no-name", el, { html: el.outerHTML.slice(0, 160) });
          const c = parentClip(el).fixed;
          if (c && (r.left < c.left - 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.bottom > c.bottom + 1))
            add("cut-off", el, { rect: [r.left, r.top, r.right, r.bottom].map(Math.round), clip: [c.left, c.top, c.right, c.bottom].map(Math.round) });
          // Off the window with no scroller to bring it back.
          if (c && r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5)) add("control-off-screen", el, { rect: [r.left, r.top, r.right, r.bottom].map(Math.round) });
        }
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
      },
      { label, SCOPE },
    );

  const faults = [];
  const errors = [];
  let shots = 0;
  // A state: do `fn`, wait out the 180 ms pop-ins, audit and capture, then
  // undo it (`close`: Escape, or a function).
  const step = async (label, fn, close) => {
    try {
      await fn();
      await page.waitForTimeout(320);
      faults.push(...(await audit(label)));
      await page.screenshot({ path: `${shotDir}/${label.replace(/[^\w-]+/g, "_")}.png` });
      shots++;
    } catch (e) {
      errors.push({ label, error: String(e).split("\n")[0].slice(0, 220) });
    }
    try {
      if (close === true) await page.keyboard.press("Escape");
      else if (close) await close();
    } catch (e) {
      errors.push({ label: `${label} (closing)`, error: String(e).split("\n")[0].slice(0, 220) });
    }
    await page.mouse.move(1, 300); // off every button: no tooltip carried over
  };
  const menu = (name) => page.locator(".menubar-button", { hasText: new RegExp(`^${name}$`) }).click();
  const menuItem = async (m, item) => {
    await menu(m);
    await page.getByRole("menuitem", { name: item }).first().click();
  };
  // Hover until the tooltip shows (450 ms delay).
  const tip = async (locator) => {
    await locator.hover();
    await page.waitForFunction(() => document.querySelector(".tooltip.on"), null, { timeout: 2000 });
  };
  // Drag a splitter far past its limit.
  const drag = async (locator, dx, dy) => {
    const b = await locator.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    await page.mouse.up();
  };
  const toHome = async () => {
    await menuItem("File", "Back to home");
    await page.locator(".home").waitFor();
  };

  // ---- projects to show --------------------------------------------------------
  await page.setViewportSize({ width: 1600, height: 940 });
  await page.goto(base);
  await page.waitForFunction(() => !!window.videoEditor);
  // Home with no projects, at every size (nothing below needs the editor).
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await step(`${w}x${h}-home-empty`, async () => {});
  }
  await page.setViewportSize({ width: 1600, height: 940 });
  const make = async (name, fill, preset) => {
    await (preset ? page.locator(".preset", { hasText: preset }).click() : page.locator(".create-card").click());
    await page.locator(".timeline-panel").waitFor();
    await page.evaluate(({ name, fill }) => {
      const v = window.videoEditor;
      v.exec("set_project", { name });
      v.exec("add_color_clip", { color: fill, start: 0, duration: 3 });
    }, { name, fill });
    await toHome();
  };
  await make("Trailer", "#884422");
  await make("Vertical teaser", "#225588", "9:16");
  await make("Square promo", "#447722", "1:1");
  await make("Interview selects", "#663399");
  await make("Old cut to delete with a long name that has to fit the trash row", "#995511");
  await make("B-roll", "#227766", "4:5");
  // One project in Recently deleted.
  const old = page.locator(".project-card", { hasText: "Old cut to delete" });
  await old.hover();
  await old.getByRole("button", { name: /^Delete / }).click();
  // The long-named project with every kind of clip: the one edited below.
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async (LONG) => {
    const v = window.videoEditor;
    const o = location.origin + "/fixtures/media/";
    v.exec("set_project", { name: LONG });
    const [vid, pic, voice, music] = await v.import([
      { name: "talk-gaps.mp4", src: o + "talk-gaps.mp4" },
      { name: "photo.jpg", src: o + "photo.jpg" },
      { name: "voice-8s.wav", src: o + "voice-8s.wav" },
      { name: "music-30s.mp3", src: o + "music-30s.mp3" },
    ]);
    v.exec("add_media_clip", { asset_id: vid.id, start: 0, duration: 4 });
    v.exec("add_media_clip", { asset_id: pic.id, start: 4, duration: 3 });
    v.exec("add_media_clip", { asset_id: voice.id, start: 0, duration: 6 });
    v.exec("add_media_clip", { asset_id: music.id, start: 0, duration: 10 });
    v.exec("add_text", { text: "A title long enough to need wrapping in the inspector", start: 1, duration: 3 });
    v.exec("add_shape", { kind: "rounded_rectangle", start: 2, duration: 3, width: 0.4, height: 0.1, color: "#101418" });
    v.exec("add_adjustment_clip", { start: 0, duration: 5 });
    v.exec("add_captions", { captions: [{ start: 0, end: 2, text: "First caption line" }, { start: 2, end: 4, text: "Second caption line" }] });
    for (let i = 0; i < 3; i++) v.exec("add_track", { kind: "video", name: `Overlay track with a long name ${i + 1}` });
    for (const [at, label] of [[0.5, "Intro"], [3, "A marker with a long label that goes on"], [6, "Outro"]]) v.exec("add_marker", { at, label });
    v.select([v.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "video").id]);
  }, LONG);
  await toHome();

  // ---- every size ------------------------------------------------------------------
  for (const [w, h] of sizes) {
    const at = `${w}x${h}`;
    await page.setViewportSize({ width: w, height: h });
    await page.reload();
    await page.waitForFunction(() => !!window.videoEditor);
    await page.locator(".project-card").first().waitFor();

    // Home.
    await step(`${at}-home`, async () => {});
    await step(`${at}-home-tip`, () => tip(page.locator(".project-card-name", { hasText: "Quarterly" })));
    await step(`${at}-home-rename`, async () => {
      const card = page.locator(".project-card", { hasText: "Quarterly" });
      await card.hover();
      await card.getByRole("button", { name: /^Rename / }).click();
    }, true);
    await step(`${at}-home-list`, async () => {
      await page.getByRole("button", { name: "List view" }).click();
      await page.locator(".project-list").waitFor();
    });
    await step(`${at}-home-list-tip`, () => tip(page.locator(".project-row").last().getByRole("button", { name: /^Delete / })));
    await step(`${at}-home-list-menu`, () => page.locator(".project-row", { hasText: "Trailer" }).click({ button: "right" }), true);
    await step(`${at}-home-list-rename`, async () => {
      const row = page.locator(".project-row", { hasText: "Quarterly" });
      await row.hover();
      await row.getByRole("button", { name: /^Rename / }).click();
    }, true);
    await page.getByRole("button", { name: "Grid view" }).click();
    // The card menu, at the last card (near the window corner when short).
    await step(`${at}-home-menu-card`, async () => {
      const last = page.locator(".project-card").last();
      await last.scrollIntoViewIfNeeded();
      const b = await last.boundingBox();
      await page.mouse.click(Math.min(b.x + b.width - 4, w - 4), Math.min(b.y + b.height - 4, h - 4), { button: "right" });
      await page.locator(".ctx-anchor .menu").waitFor();
    }, true);
    await page.locator(".home").evaluate((e) => e.scrollTo(0, 0));
    await step(`${at}-home-search-empty`, () => page.getByPlaceholder("Search projects").fill("A search for a project name that matches none of them at all"), () => page.getByPlaceholder("Search projects").fill(""));
    await step(`${at}-home-trash`, async () => {
      await page.locator(".home-trash summary").click();
      await page.locator(".trash-row").first().scrollIntoViewIfNeeded();
    });
    await page.locator(".home-trash summary").click();
    await step(`${at}-home-menu-File`, () => menu("File"), true);
    await step(`${at}-home-menu-Help`, () => menu("Help"), true);
    await step(`${at}-home-about`, () => menuItem("Help", /^About /), true);
    await step(`${at}-home-prefs`, () => page.getByRole("button", { name: "Preferences", exact: true }).click(), true);
    await step(`${at}-home-shortcuts`, () => page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click(), true);

    // The editor.
    await page.locator(".project-card", { hasText: "Quarterly" }).click();
    await page.locator(".timeline-panel").waitFor();
    await page.evaluate(() => window.videoEditor.select([window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "video").id]));
    await step(`${at}-editor`, async () => {});
    await step(`${at}-title-rename`, () => page.locator("button.project-name").click(), true);
    for (const m of ["File", "Edit", "Timeline", "View", "Help"]) await step(`${at}-menu-${m}`, () => menu(m), true);
    await step(`${at}-tip-export`, () => tip(page.locator(".export-btn")));
    await step(`${at}-tip-name`, () => tip(page.locator("button.project-name")));

    // The splitters at their limits; View > Reset layout after each.
    const reset = () => menuItem("View", "Reset layout");
    const splitX = page.locator(".top-row > .splitter-x");
    await step(`${at}-split-left-min`, () => drag(splitX.first(), -900, 0), reset);
    await step(`${at}-split-left-max`, () => drag(splitX.first(), 900, 0), reset);
    await step(`${at}-split-right-min`, () => drag(splitX.last(), 900, 0), reset);
    await step(`${at}-split-right-max`, () => drag(splitX.last(), -900, 0), reset);
    await step(`${at}-split-top-min`, () => drag(page.locator(".workspace > .splitter-y"), 0, -900), reset);
    await step(`${at}-split-top-max`, () => drag(page.locator(".workspace > .splitter-y"), 0, 900), reset);

    // Dialogs.
    await step(`${at}-export`, () => page.locator(".export-btn").click(), true);
    await step(`${at}-export-custom`, async () => {
      await page.locator(".export-btn").click();
      await page.locator("#export-quality").selectOption("custom");
      await page.locator(".export-body").evaluate((e) => e.scrollTo(0, e.scrollHeight));
    }, true);
    // The done view, after a half-second In to Out export into the
    // browser's own storage (headless has no save dialog).
    await step(`${at}-export-done`, async () => {
      await page.evaluate(() => {
        window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle("sizes-shell.mp4", { create: true });
        const v = window.videoEditor;
        v.seek(0);
        v.action("markIn");
        v.seek(15);
        v.action("markOut");
      });
      await page.locator(".export-btn").click();
      await page.getByRole("radio", { name: "In to Out" }).click();
      await page.locator(".export-dialog .export-go").click();
      await page.getByRole("heading", { name: "Export complete" }).waitFor({ timeout: 60000 });
    }, async () => {
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.videoEditor.action("clearInOut"));
    });
    await step(`${at}-prefs`, () => menuItem("Edit", /Preferences/), true);
    await step(`${at}-shortcuts`, () => menuItem("Help", /shortcuts/i), true);
    await step(`${at}-shortcuts-edit`, async () => {
      await menuItem("Help", /shortcuts/i);
      // Listening for the new keys (none pressed: the keymap stays).
      await page.locator(".shortcuts-edit").first().click();
      await page.locator(".shortcuts-listen").waitFor();
    }, async () => {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    });
    // A taken chord asks before moving it (Space plays: nothing is saved).
    await step(`${at}-shortcuts-conflict`, async () => {
      await menuItem("Help", /shortcuts/i);
      await page.locator(".shortcuts-edit").nth(1).click();
      await page.locator(".shortcuts-listen").waitFor();
      await page.keyboard.press("Space");
      await page.locator(".shortcuts-conflict").waitFor();
    }, async () => {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    });
    await step(`${at}-about`, () => menuItem("Help", /^About /), true);
    // A tip inside a modal dialog: the source monitor's Insert.
    await step(`${at}-source-tip`, async () => {
      const lib = page.getByRole("region", { name: "Library" });
      await lib.getByRole("tab", { name: "Media", exact: true }).click();
      await page.locator(".media-preview-button").first().click();
      await tip(page.getByRole("dialog").getByRole("button", { name: "Insert", exact: true }));
    }, true);
    await step(`${at}-save-copy`, () => menuItem("File", /Save a copy/), true);
    for (const expanded of [false, true]) await step(`${at}-manage-media${expanded ? "-folders" : ""}`, async () => {
      const lib = page.getByRole("region", { name: "Library" });
      await lib.getByRole("tab", { name: "Media", exact: true }).click();
      await page.locator(".media-clear", { hasText: "Manage media" }).click();
      if (expanded) await page.locator(".folder-editor summary").click();
    }, true);
    await step(`${at}-marker-export`, async () => {
      await menuItem("View", "Markers");
      await page.getByRole("button", { name: "Export shown markers" }).click();
      await page.getByRole("dialog", { name: "Export markers" }).getByRole("combobox").selectOption("chapters");
    }, true);

    // The AI assistant, docked.
    await step(`${at}-assistant`, async () => {
      await page.locator(".assistant-btn").click();
      await page.locator(".assistant-status", { hasText: "Ready" }).waitFor();
    });
    await step(`${at}-assistant-reply`, async () => {
      await page.locator(".composer textarea").fill("Add a title that says hello and a dissolve between the first two clips, then tell me what you did");
      await page.locator(".composer textarea").press("Enter");
      await page.locator(".msg-assistant:not(.live) p").last().waitFor();
    });
    await step(`${at}-assistant-tip`, () => tip(page.getByRole("button", { name: "Close AI assistant" })));
    await step(`${at}-assistant-menu-View`, () => menu("View"), true);
    await step(`${at}-assistant-export`, () => page.locator(".export-btn").click(), true);
    // Docked where the editor keeps its 760 px beside it, else floating.
    const floating = await page.locator("aside.assistant.floating").count();
    if (floating !== (w < 1066 ? 1 : 0)) errors.push({ label: `${at}-assistant`, error: `floating: ${floating}` });
    const dockSplit = page.locator(".workspace.docked > .splitter-x");
    if (!floating) {
      await step(`${at}-assistant-split-min`, () => drag(dockSplit, 900, 0));
      await step(`${at}-assistant-split-max`, () => drag(dockSplit, -900, 0), () => dockSplit.dblclick());
    }
    await step(`${at}-assistant-agents`, () => page.getByRole("tab", { name: "Connect agents" }).click(), () => page.getByRole("tab", { name: "Chat" }).click());
    await page.getByRole("button", { name: "New conversation" }).click().catch(() => {});
    await page.locator(".assistant-btn").click();
    await toHome();
  }

  // ---- the desktop title bar: window buttons, Connect agents ---------------------------------
  const mocks = (await (await page.request.get(`${base}/node_modules/@tauri-apps/api/mocks.js`)).text()).replace(/^export \{[^}]*\};?\s*$/m, "").replace(/\/\/# sourceMappingURL=.*$/m, "");
  const setup = () => {
    mockIPC(
      (cmd, args) => {
        if (cmd === "project_list") return [];
        if (cmd === "render_job") return null;
        if (cmd === "plugin:window|is_maximized") return false;
        if (cmd === "model_request") return [200, JSON.stringify({ models: [{ name: "llama3.1:8b" }] })];
        if (cmd === "mcp_enable")
          return args.on ? { url: "http://127.0.0.1:47280/mcp", token: "0123456789abcdef0123456789abcdef", stdio: '"C:\\Program Files\\OpenFrame\\openframe.exe" --mcp-stdio', exe: "C:\\Program Files\\OpenFrame\\openframe.exe" } : null;
        return null;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    mockConvertFileSrc("windows");
  };
  const desk = await page.context().browser().newContext({ viewport: { width: 1100, height: 680 } });
  const main = page;
  try {
    page = await desk.newPage();
    await page.addInitScript({ content: `${mocks}\n(${setup})();` });
    await page.goto(base);
    for (const [w, h] of [[1100, 680], [1280, 720]]) {
      const at = `desktop-${w}x${h}`;
      await page.setViewportSize({ width: w, height: h });
      await page.locator(".home").waitFor();
      await step(`${at}-home`, async () => {});
      await step(`${at}-tip-close`, () => tip(page.getByRole("button", { name: "Close", exact: true })));
      await page.locator(".create-card").click();
      await page.locator(".timeline-panel").waitFor();
      await page.evaluate((LONG) => window.videoEditor.exec("set_project", { name: LONG }), LONG);
      await step(`${at}-editor`, async () => {});
      await step(`${at}-menu-Help`, () => menu("Help"), true);
      await step(`${at}-assistant`, async () => {
        await page.locator(".assistant-btn").click();
        await page.getByRole("tab", { name: "Connect agents" }).click();
        const sw = page.getByRole("switch", { name: "Allow AI agents" });
        if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
        await page.locator(".agent-client").first().waitFor();
      });
      await step(`${at}-assistant-narrowest`, () => drag(page.locator(".workspace.docked > .splitter-x"), 900, 0));
      await page.locator(".assistant-btn").click();
      await menuItem("File", "Back to home");
    }
  } finally {
    page = main;
    await desk.close();
  }

  const by = {};
  for (const f of faults) (by[f.kind] ??= []).push(f);
  const details = Object.fromEntries(Object.entries(by).map(([k, list]) => [k, { ok: false, count: list.length, list }]));
  details.steps = { ok: errors.length === 0, errors, shots };
  return { ok: faults.length === 0 && errors.length === 0, details };
};
