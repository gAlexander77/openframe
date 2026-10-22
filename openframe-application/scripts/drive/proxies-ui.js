// Web-only proxy controls and refusal, plus a visibly different substitute
// proving preview uses the copy while stills, agent review and export do not.
async (page) => {
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const ids = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [original, copy] = await ve.import([
      { name: "framecode-30.mp4", src: location.origin + "/fixtures/media/framecode-30.mp4" },
      { name: "h264-720p60-longgop.mp4", src: location.origin + "/fixtures/media/h264-720p60-longgop.mp4" },
    ]);
    if (!original || !copy) throw new Error("Both proxy-policy fixtures must import");
    ve.exec("add_media_clip", { asset_id: original.id, start: 0, duration: 1 });
    ve.exec("add_media_clip", { asset_id: copy.id, start: 1, duration: 1 });
    return { original: original.id, copy: copy.id };
  });
  const toggle = page.getByRole("button", { name: "Proxy playback", exact: true });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  const tipOn = await toggle.getAttribute("data-tip");
  await toggle.click();
  const tipOff = await toggle.getAttribute("data-tip");
  details.toggle = { ok: (await toggle.getAttribute("aria-pressed")) === "false" && /on/.test(tipOn) && /off/.test(tipOff) && tipOn !== tipOff && await page.evaluate(() => JSON.parse(localStorage.getItem("ve.prefs")).proxyPlayback === false), tipOn, tipOff };
  await page.keyboard.press("Alt+Shift+P");
  details.shortcut = { ok: (await toggle.getAttribute("aria-pressed")) === "true" };
  await page.getByRole("button", { name: "View", exact: true }).click();
  details.viewMenu = { ok: await page.getByRole("menuitem", { name: /Proxy playback/ }).isVisible() };
  await page.keyboard.press("Escape");
  const card = page.locator(".media-card").filter({ has: page.locator('.card-label', { hasText: "framecode-30.mp4" }) });
  await card.click({ button: "right" });
  details.menu = { ok: await page.getByRole("menuitem", { name: "Create proxy", exact: true }).isVisible() && await page.getByRole("menuitem", { name: "Delete proxy", exact: true }).isVisible() };
  await page.getByRole("menuitem", { name: "Create proxy", exact: true }).click();
  details.sizes = { ok: await page.getByRole("menuitem", { name: "Half (default)", exact: true }).isVisible() && await page.getByRole("menuitem", { name: "Quarter", exact: true }).isVisible() && await page.getByRole("menuitem", { name: "720p", exact: true }).isVisible() };
  await page.getByRole("menuitem", { name: "Half (default)", exact: true }).click();
  await page.getByText(/Playback proxies are not available in the browser build/).first().waitFor();
  details.uiRefusal = { ok: await page.getByText(/Playback proxies are not available in the browser build/).first().isVisible() };
  await page.getByRole("checkbox", { name: "Select framecode-30.mp4", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select h264-720p60-longgop.mp4", exact: true }).check();
  await card.click({ button: "right" });
  details.batchMenu = { ok: await page.getByRole("menuitem", { name: "Create proxies (2)", exact: true }).isVisible() && await page.getByRole("menuitem", { name: "Delete proxies (2)", exact: true }).isVisible() };
  await page.keyboard.press("Escape");
  details.mcpRefusal = await page.evaluate(async (ids) => {
    const errors = [];
    for (const name of ["create_proxies", "delete_proxies"]) {
      const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { asset_ids: [ids.original] } } });
      errors.push({ name, isError: r.result?.isError, text: r.result?.content?.[0]?.text });
    }
    return { ok: errors.every((r) => r.isError && /not available in the browser build/.test(r.text)), errors };
  }, ids);
  const policy = await page.evaluate(async (ids) => {
    const ve = window.videoEditor;
    const code = ({ width: w, height: h, data }) => {
      let n = 0;
      for (let i = 0; i < 10; i++) if (data[(Math.floor(h / 2) * w + Math.floor((i + 0.5) * w / 10)) * 4] > 128) n |= 1 << i;
      return n;
    };
    const samples = () => {
      const { width: w, height: h, data } = ve.pixels(160);
      const out = [];
      for (let y = 1; y < 6; y++) for (let x = 1; x < 10; x++) {
        const at = (Math.floor(y * h / 6) * w + Math.floor(x * w / 10)) * 4;
        out.push(...data.slice(at, at + 3));
      }
      return out;
    };
    const delta = (a, b) => a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length;
    ve.seek(15); await ve.rendered();
    const original = samples(), originalCode = code(ve.pixels());
    ve.seek(45); await ve.rendered();
    const proxy = samples();
    // Deliberate test-only document stub: use the public document, then a
    // real metadata command to notify the live store. No duplicate Vite imports.
    const a = ve.project().assets.find((a) => a.id === ids.original);
    const b = ve.project().assets.find((a) => a.id === ids.copy);
    a.playbackProxy = { src: b.src, width: b.width, height: b.height, size: "half", fingerprint: "web-drive-original" };
    ve.exec("rename_media", { asset_id: a.id, name: "Original with proxy" });
    ve.seek(15); await ve.rendered();
    const viewingProxy = samples();
    const readPng = async (url) => {
      const bmp = await createImageBitmap(await (await fetch(url)).blob());
      try {
        const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        return code({ width: bmp.width, height: bmp.height, data: g.getImageData(0, 0, bmp.width, bmp.height).data });
      } finally { bmp.close(); }
    };
    const still = await ve.still(15, "480p");
    const stillCode = await readPng(still.url); URL.revokeObjectURL(still.url);
    const review = await ve.mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "preview_frame", arguments: { at: 0.5, max_width: 320 } } });
    const png = review.result.content.find((c) => c.type === "image");
    const reviewCode = await readPng("data:image/png;base64," + png.data);
    const rendered = await ve.render({ format: "webm", resolution: "480p", audio: false, start: 0.5, end: 0.7 });
    let renderCode;
    const video = document.createElement("video"); video.muted = true; video.preload = "auto";
    try {
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error("Exported WebM could not be decoded")); video.src = rendered.url; });
      const c = new OffscreenCanvas(video.videoWidth, video.videoHeight), g = c.getContext("2d");
      g.drawImage(video, 0, 0);
      renderCode = code({ width: c.width, height: c.height, data: g.getImageData(0, 0, c.width, c.height).data });
    } finally { video.removeAttribute("src"); video.load(); URL.revokeObjectURL(rendered.url); }
    ve.action("toggleProxies"); await ve.rendered();
    const offCode = code(ve.pixels());
    ve.action("toggleProxies"); await ve.rendered();
    return { originalCode, stillCode, reviewCode, renderCode, offCode, proxyDelta: delta(proxy, viewingProxy), originalDelta: delta(original, viewingProxy), state: ve.describe().assets.find((a) => a.id === ids.original).proxy };
  }, ids);
  details.previewPolicy = { ok: policy.proxyDelta < 3 && policy.originalDelta > 20 && policy.state === "ready", ...policy };
  details.deliveryPolicy = { ok: [policy.originalCode, policy.stillCode, policy.reviewCode, policy.renderCode, policy.offCode].every((n) => n === 15) };
  details.badge = { ok: await page.locator('.proxy-badge.ready').isVisible() };
  await page.getByRole("button", { name: "Manage media", exact: true }).click();
  details.manager = { ok: await page.getByRole("button", { name: "Proxies for 4K and HEVC", exact: true }).isVisible() && await page.getByText(/Proxies: 1 of 2 videos/).isVisible() };
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator('.player-scopes').click();
  const scopeCode = await page.evaluate(async () => {
    await window.videoEditor.rendered();
    const { width: w, height: h, data } = window.videoEditor.pixels();
    let n = 0;
    for (let i = 0; i < 10; i++) if (data[(Math.floor(h / 2) * w + Math.floor((i + 0.5) * w / 10)) * 4] > 128) n |= 1 << i;
    return n;
  });
  details.scopes = { ok: scopeCode === 15, scopeCode };
  return { ok: Object.values(details).every((d) => d.ok), details };
}
