// An AI agent's changes are announced at the top of the window, under the
// Bot icon, at 1600 x 950, 1100 x 680 and 2560 x 1440. Tool calls arrive
// as MCP JSON-RPC (window.videoEditor.mcp), the path the desktop bridge and
// the docked assistant both take. Checks: an edit raises one notice
// ("AI agent", the Bot icon, the edit's name) under the title bar, centered
// and inside the window; a run of edits retitles it rather than stacking;
// a read-only call raises nothing; an edit made outside MCP is not
// announced; the notice leaves after a quiet spell.
async (page) => {
  page.setDefaultTimeout(8000);
  const base = "http://localhost:1420";
  const shots = "__REPO__/scratch/agent-notice";
  const details = {};
  const check = (name, ok, extra = {}) => (details[name] = { ok: !!ok, ...extra });
  const call = (name, args = {}) =>
    page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const notices = () =>
    page.$$eval(".toasts-agent .toast", (els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { text: e.textContent, bot: !!e.querySelector(".toast-agent svg"), l: r.left, r: r.right, t: r.top, b: r.bottom };
      }),
    );

  for (const [w, h] of [
    [1600, 950],
    [1100, 680],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(base);
    await page.locator(".create-card").first().click();
    await page.locator(".timeline-panel").waitFor();
    const bar = await page.locator(".titlebar").boundingBox();

    await call("add_text", { text: "Hello", start: 0, duration: 3 });
    await page.locator(".toasts-agent .toast").waitFor();
    // Measured once its slide-in has settled.
    await page.waitForFunction(() => document.querySelector(".toasts-agent .toast").getAnimations().every((a) => a.playState === "finished"));
    let n = await notices();
    check(`${w}: one notice`, n.length === 1, { n });
    check(`${w}: says it is the agent, with the Bot`, n[0]?.bot && /^AI agent/.test(n[0].text) && /Add text/.test(n[0].text), { text: n[0]?.text });
    check(`${w}: under the title bar, inside the window`, n[0] && n[0].t >= bar.y + bar.height && n[0].l >= 0 && n[0].r <= w && n[0].b < h / 4, { n: n[0] });
    check(`${w}: centered`, n[0] && Math.abs((n[0].l + n[0].r) / 2 - w / 2) < 2, { n: n[0] });
    await page.screenshot({ path: `${shots}-${w}.png` });

    await call("add_shape", { kind: "rectangle", start: 0, duration: 3 });
    await call("set_project", { name: "Agent notice" });
    n = await notices();
    check(`${w}: a run of edits retitles one notice`, n.length === 1 && /Project settings/.test(n[0].text), { n });

    await call("describe_project");
    check(`${w}: a read-only call adds nothing`, (await notices()).length === 1);

    // Scripts and the app's own edits (exec, not MCP) are not the agent's.
    await page.evaluate(() => window.videoEditor.exec("add_text", { text: "Mine", start: 3, duration: 2 }));
    n = await notices();
    check(`${w}: an edit outside MCP is not announced`, n.length === 1 && /Project settings/.test(n[0].text), { n });

    await page.waitForFunction(() => !document.querySelector(".toasts-agent .toast"), null, { timeout: 6000 }).catch(() => {});
    check(`${w}: the notice leaves after a quiet spell`, (await notices()).length === 0);
  }
  return { ok: Object.values(details).every((d) => d.ok), details };
};
