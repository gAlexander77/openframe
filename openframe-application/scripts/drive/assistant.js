// The AI assistant panel (called Copilot until 2026-10-17), docked as the
// editor's right-hand column (ADR-064), at 1600 x 950, 1280 x 720 and the
// desktop's 1100 x 680 minimum. Ollama is stubbed before the panel opens,
// so no installed model's name reaches a result or a screenshot.
// Checks: the title-bar toggle stays pressed with focus in the panel; the
// column overlaps no panel, lines up with the inspector's top and the
// timeline's bottom, and leaves the player header's icon, the loudness
// readout and the timeline's zoom controls in view; the composer (input
// and send button aligned, placeholder centered, even padding, grows to
// five lines, Enter sends, busy state, Stop); long replies wrap; then, with
// the desktop's IPC mocked, the Codex and Claude Code rows and the one-click
// buttons, which the web build hides.
async (page) => {
  page.setDefaultTimeout(8000);
  const base = "http://localhost:1420";
  const shots = "__REPO__/scratch/assistant";
  const MODEL = "llama3.1:8b";
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
  // The chat stub answers after a pause (to see the busy state); a request
  // asking for "long" gets one unbroken 300-character word back.
  let chatDelay = 1200;
  await page.context().route("http://127.0.0.1:11434/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.url().endsWith("/api/tags")) return route.fulfill({ headers: cors, contentType: "application/json", body: JSON.stringify({ models: [{ name: MODEL }] }) });
    if (req.url().endsWith("/api/chat")) {
      await new Promise((r) => setTimeout(r, chatDelay));
      const body = JSON.parse(req.postData() || "{}");
      const last = body.messages?.at(-1)?.content ?? "";
      const content = /long/.test(last) ? "x".repeat(300) : "Stub reply: nothing changed.";
      return route.fulfill({ headers: cors, contentType: "application/json", body: JSON.stringify({ message: { role: "assistant", content } }) }).catch(() => {});
    }
    return route.fulfill({ status: 404, headers: cors, body: "" });
  });

  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  const rect = (sel) =>
    page.evaluate((sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    }, sel);
  const inside = (a, b, slack = 0.5) => !!a && !!b && a.l >= b.l - slack && a.r <= b.r + slack && a.t >= b.t - slack && a.b <= b.b + slack;
  const overlaps = (a, b) => !!a && !!b && Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;

  for (const [w, h] of [
    [1600, 950],
    [1280, 720],
    [1100, 680],
  ]) {
    const at = `${w}`;
    await page.setViewportSize({ width: w, height: h });
    await page.goto(base);
    await page.locator(".create-card").first().click();
    await page.locator(".timeline-panel").waitFor();
    await page.evaluate(async () => {
      const api = window.videoEditor;
      const [vid] = await api.import([{ name: "talk-gaps.mp4", src: location.origin + "/fixtures/media/talk-gaps.mp4" }]);
      api.exec("add_media_clip", { asset_id: vid.id, start: 0, duration: 4 });
      api.select([api.project().tracks.flatMap((t) => t.clips)[0].id]);
    });
    const button = page.locator(".assistant-btn");
    await button.click();
    const panel = page.locator("aside.assistant");
    await panel.waitFor();
    await page.waitForFunction(() => document.querySelector(".assistant-status")?.textContent === "Ready");

    // Names, once.
    if (w === 1600) {
      const label = (await button.innerText()).trim();
      const heading = (await panel.locator("header strong").innerText()).trim();
      const named = await panel.getAttribute("aria-label");
      const copilot = await page.evaluate(() => document.body.innerText.includes("Copilot"));
      check("names", label === "AI assistant" && heading === "AI assistant" && named === "AI assistant" && !copilot, { label, heading, named, copilot });
    }

    // The toggle stays pressed with focus in the panel, in the app's on style.
    await page.locator(".composer textarea").focus();
    await page.mouse.move(w / 2, h / 2); // off the button: no hover style
    await page.waitForTimeout(200);
    const pressed = await page.evaluate(() => {
      const b = document.querySelector(".assistant-btn");
      return { aria: b.getAttribute("aria-pressed"), bg: getComputedStyle(b).backgroundColor, focusInPanel: !!document.activeElement.closest("aside.assistant") };
    });
    // The app's on style: --accent-soft, rgb(0 193 205 / 15%).
    check(`${at} toggle pressed`, pressed.aria === "true" && pressed.focusInPanel && pressed.bg === "rgba(0, 193, 205, 0.15)", pressed);

    // A column the layout makes room for.
    const r = {
      panel: await rect("aside.assistant"),
      insp: await rect("section[aria-label=Inspector]"),
      lib: await rect("section[aria-label=Library]"),
      player: await rect("section[aria-label=Player]"),
      timeline: await rect("section.timeline-panel"),
      toolbar: await rect(".tl-toolbar"),
      scopes: await rect(".player-scopes"),
      // The loudness readout: the meter, and the LUFS figures while playing.
      lufs: await rect(".lufs"),
      meter: await rect(".meter"),
      zoomIn: await rect('.tl-toolbar [aria-label="Zoom in"]'),
      zoomOut: await rect('.tl-toolbar [aria-label="Zoom out"]'),
      fit: await rect(".fit-btn"),
      right: await rect(".tl-tools.right"),
    };
    const pageScroll = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight);
    check(`${at} column`, !pageScroll && !overlaps(r.panel, r.insp) && !overlaps(r.panel, r.timeline) && !overlaps(r.panel, r.player) && r.panel.l >= r.insp.r + 6 - 0.5 && r.panel.r <= w - 6 + 0.5, { panel: r.panel, insp: r.insp, pageScroll });
    check(`${at} column lines up`, Math.abs(r.panel.t - r.insp.t) < 0.5 && Math.abs(r.panel.b - r.timeline.b) < 0.5 && Math.abs(h - r.panel.b - 6) < 0.5, { top: [r.panel.t, r.insp.t], bottom: [r.panel.b, r.timeline.b, h] });
    check(`${at} editor in view`, inside(r.scopes, r.player) && inside(r.meter, r.player) && (!r.lufs || inside(r.lufs, r.player)) && [r.zoomIn, r.zoomOut, r.fit].every((z) => inside(z, r.toolbar)) && r.right.r <= r.toolbar.r - 7.5, {
      scopes: r.scopes,
      meter: r.meter,
      lufs: r.lufs,
      zoomIn: r.zoomIn,
      toolbar: r.toolbar,
      rightTools: r.right,
    });
    // The library keeps a column where it fits (it steps aside at 1100).
    check(`${at} library`, w === 1100 ? !r.lib : r.lib && r.lib.w >= 240, { lib: r.lib, player: r.player.w });
    check(`${at} player wide enough`, r.player.w >= 456, { player: r.player.w });

    // The model's full name is in its tip.
    const tip = await page.locator(".assistant-config select[aria-label=Model]").getAttribute("data-tip");
    check(`${at} model tip`, tip === MODEL, { tip });

    // The composer: one line as tall as the send button, centered on it,
    // with even padding around the box.
    const geo = await page.evaluate(() => {
      const box = (e) => e.getBoundingClientRect();
      const ta = document.querySelector(".composer textarea");
      const send = document.querySelector(".composer-send");
      const comp = document.querySelector(".composer");
      const wrap = document.querySelector(".assistant-composer");
      const cs = getComputedStyle(ta);
      const wcs = getComputedStyle(wrap);
      const [t, s, c, p] = [box(ta), box(send), box(comp), box(document.querySelector("aside.assistant"))];
      return {
        ta: [t.top, t.bottom].map(Math.round),
        send: [s.top, s.bottom].map(Math.round),
        centers: [(t.top + t.bottom) / 2, (s.top + s.bottom) / 2],
        padTop: parseFloat(cs.paddingTop),
        padBottom: parseFloat(cs.paddingBottom),
        lineHeight: parseFloat(cs.lineHeight),
        height: t.height,
        gaps: { left: c.left - p.left, right: p.right - c.right, bottom: p.bottom - c.bottom, wrapPad: [wcs.paddingTop, wcs.paddingRight, wcs.paddingBottom, wcs.paddingLeft] },
        sendDisabled: send.disabled,
      };
    });
    check(
      `${at} composer`,
      Math.abs(geo.centers[0] - geo.centers[1]) < 0.5 &&
        Math.abs(geo.height - (geo.send[1] - geo.send[0])) < 0.5 &&
        geo.padTop === geo.padBottom &&
        Math.abs(geo.height - geo.lineHeight - geo.padTop - geo.padBottom) < 0.5 &&
        Math.abs(geo.gaps.left - geo.gaps.bottom) < 0.5 &&
        Math.abs(geo.gaps.right - geo.gaps.bottom) < 0.5 &&
        geo.sendDisabled,
      geo,
    );
    await page.screenshot({ path: `${shots}/${at}-panel.png` });

    // Grows to five lines, then scrolls; Enter sends, Shift+Enter breaks.
    const ta = page.locator(".composer textarea");
    await ta.fill("one");
    for (let i = 2; i <= 8; i++) {
      await ta.press("Shift+Enter");
      await ta.type(`line ${i}`);
    }
    const grown = await ta.evaluate((t) => ({ h: t.getBoundingClientRect().height, scroll: t.scrollHeight, lines: t.value.split("\n").length, overflow: getComputedStyle(t).overflowY }));
    const sendEnabled = await page.locator(".composer-send").isEnabled();
    check(`${at} composer grows`, grown.lines === 8 && Math.abs(grown.h - (5 * 20 + 8)) < 0.5 && grown.scroll > grown.h && grown.overflow === "auto" && sendEnabled, { ...grown, sendEnabled });
    if (w === 1280) await page.screenshot({ path: `${shots}/${at}-composer-grown.png` });

    // Enter sends; the busy state shows (send disabled, Stop, the status).
    await ta.fill(w === 1100 ? "Reply with something long" : "Add a title");
    chatDelay = 1500;
    await ta.press("Enter");
    await page.locator(".msg.live .thinking").waitFor();
    const busy = await page.evaluate(() => ({
      text: document.querySelector(".composer textarea").value,
      send: document.querySelector(".composer-send").disabled,
      status: document.querySelector(".assistant-status").textContent,
      stop: !!document.querySelector(".stop-btn"),
      user: document.querySelector(".msg-user p")?.textContent,
    }));
    check(`${at} busy`, busy.text === "" && busy.send && busy.status === "Working…" && busy.stop && !!busy.user, busy);
    if (w === 1600) {
      await page.waitForTimeout(400); // past the bubbles' rise-in
      await page.screenshot({ path: `${shots}/${at}-busy.png` });
    }
    await page.locator(".msg-assistant:not(.live) p").last().waitFor();
    const reply = await page.evaluate(() => {
      const list = document.querySelector(".assistant-list");
      return { text: [...document.querySelectorAll(".msg-assistant p")].at(-1).textContent.slice(0, 40), wide: list.scrollWidth > list.clientWidth + 1, status: document.querySelector(".assistant-status").textContent };
    });
    check(`${at} reply`, !reply.wide && reply.status === "Ready", reply);
    if (w === 1100) await page.screenshot({ path: `${shots}/${at}-long-reply.png` });

    // Stop ends a turn at once.
    if (w === 1600) {
      chatDelay = 4000;
      await ta.fill("Add a title");
      await ta.press("Enter");
      await page.locator(".stop-btn").click();
      const stopped = await page.evaluate(() => ({ last: [...document.querySelectorAll(".msg p")].at(-1)?.textContent, status: document.querySelector(".assistant-status").textContent }));
      check("stop", stopped.last === "Stopped." && stopped.status === "Ready", stopped);
      chatDelay = 1200;
    }

    // The timeline's menus still open where their buttons are.
    await page.locator(".tool-btn").click();
    await page.waitForTimeout(300);
    const menu = await page.evaluate(() => {
      const m = document.querySelector(".tool-picker .menu").getBoundingClientRect();
      const b = document.querySelector(".tool-btn").getBoundingClientRect();
      return { menu: [m.left, m.top].map(Math.round), button: [b.left, b.bottom].map(Math.round), inView: m.right <= innerWidth && m.bottom <= innerHeight && m.top >= 0 };
    });
    check(`${at} tool menu`, menu.inView && Math.abs(menu.menu[0] - menu.button[0]) < 40, menu);
    await page.keyboard.press("Escape");

    // The web build has no agents server: a note, no rows or buttons.
    await page.getByRole("tab", { name: "Connect agents" }).click();
    const web = await page.evaluate(() => ({
      note: !!document.querySelector(".agents-note"),
      rows: document.querySelectorAll(".agent-row").length,
      buttons: [...document.querySelectorAll("aside.assistant button")].filter((b) => /^Add to/.test(b.textContent.trim())).length,
    }));
    check(`${at} web agents tab`, web.note && web.rows === 0 && web.buttons === 0, web);
    await page.getByRole("tab", { name: "Chat" }).click();

    // Closing gives the room back.
    await page.locator('[aria-label="Close AI assistant"]').click();
    const closed = await page.evaluate(() => ({
      pressed: document.querySelector(".assistant-btn").getAttribute("aria-pressed"),
      docked: !!document.querySelector(".workspace.docked"),
      panel: !!document.querySelector("aside.assistant"),
      lib: !!document.querySelector("section[aria-label=Library]"),
    }));
    check(`${at} closed`, closed.pressed === "false" && !closed.docked && !closed.panel && closed.lib, closed);
  }

  // The desktop, its IPC mocked with Tauri's own mocks: the agents tab.
  const mocks = (await (await page.request.get(`${base}/node_modules/@tauri-apps/api/mocks.js`)).text()).replace(/^export \{[^}]*\};?\s*$/m, "").replace(/\/\/# sourceMappingURL=.*$/m, "");
  const setup = () => {
    window.agentCalls = [];
    mockIPC(
      (cmd, args) => {
        if (/^agent_cli|^mcp_enable/.test(cmd)) window.agentCalls.push([cmd, args]);
        if (cmd === "project_list") return [];
        if (cmd === "render_job") return null;
        if (cmd === "plugin:window|is_maximized") return false;
        if (cmd === "model_request") return [200, JSON.stringify({ models: [{ name: "llama3.1:8b" }] })];
        if (cmd === "mcp_enable")
          return args.on ? { url: "http://127.0.0.1:47280/mcp", token: "0123456789abcdef0123456789abcdef", stdio: '"C:\\Program Files\\OpenFrame\\openframe.exe" --mcp-stdio', exe: "C:\\Program Files\\OpenFrame\\openframe.exe" } : null;
        if (cmd === "agent_cli_add") return args.cli === "codex" ? { status: "exists", detail: "" } : { status: "missing", detail: "" };
        return null;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    mockConvertFileSrc("windows");
  };
  // Its own context: the runner's page comes from browser.newPage().
  const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 720 } });
  const desk = await ctx.newPage();
  try {
    await desk.addInitScript({ content: `${mocks}\n(${setup})();` });
    await desk.goto(base);
    await desk.locator(".create-card").first().click();
    await desk.locator(".timeline-panel").waitFor();
    await desk.locator(".assistant-btn").click();
    await desk.getByRole("tab", { name: "Connect agents" }).click();
    await desk.getByRole("switch", { name: "Allow AI agents" }).click();
    await desk.locator(".agent-client").first().waitFor();
    const sw = await desk.evaluate(() => {
      const t = document.querySelector('[role=switch][aria-label="Allow AI agents"]').getBoundingClientRect();
      const p = document.querySelector(".assistant-agents").getBoundingClientRect();
      return { switch: [t.left, t.right].map(Math.round), pane: [p.left, p.right].map(Math.round), width: Math.round(t.width) };
    });
    check("desktop switch in view", sw.width === 30 && sw.switch[1] <= sw.pane[1] - 12, sw);
    const rows = await desk.evaluate(() => [...document.querySelectorAll(".agent-client")].map((s) => ({ name: s.getAttribute("aria-label"), add: s.querySelector(".agent-add")?.textContent.trim() ?? null, values: [...s.querySelectorAll(".agent-value")].map((v) => v.textContent) })));
    const codex = rows.find((r) => r.name === "Codex");
    check(
      "desktop Codex rows",
      codex?.add === "Add to Codex" &&
        codex.values[0] === 'codex mcp add openframe -- "C:\\Program Files\\OpenFrame\\openframe.exe" --mcp-stdio' &&
        codex.values[1].startsWith('[mcp_servers.openframe]\ncommand = "C:\\\\Program Files\\\\OpenFrame\\\\openframe.exe"\nargs = ["--mcp-stdio"]'),
      { codex },
    );
    check("desktop Claude Code button", rows.find((r) => r.name === "Claude Code")?.add === "Add to Claude Code", { rows: rows.map((r) => [r.name, r.add]) });
    await desk.getByRole("button", { name: "Add to Codex" }).click();
    await desk.locator('[aria-label=Codex] .agent-result').waitFor();
    await desk.getByRole("button", { name: "Add to Claude Code" }).click();
    await desk.locator('[aria-label="Claude Code"] .agent-result').waitFor();
    await desk.getByRole("button", { name: /Install Claude Code/ }).click();
    const results = await desk.evaluate(() => ({
      codex: document.querySelector("[aria-label=Codex] .agent-result").textContent,
      claude: document.querySelector('[aria-label="Claude Code"] .agent-result').textContent,
      calls: window.agentCalls.map(([c, a]) => `${c}:${a.cli ?? a.on}`),
    }));
    check(
      "desktop one-click results",
      /already has a server named "openframe"; nothing was changed/.test(results.codex) && /not found/.test(results.claude) && results.calls.includes("agent_cli_add:codex") && results.calls.includes("agent_cli_install_page:claude"),
      results,
    );
    await desk.waitForTimeout(300);
    await desk.screenshot({ path: `${shots}/1280-desktop-agents.png` });
  } finally {
    await ctx.close();
  }

  return { ok: Object.values(details).every((d) => d.ok), details };
};
