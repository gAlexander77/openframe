// Timeline background menu, clipboard state, marker time, and native text menus.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  const details = {};
  const open = async () => {
    const b = await page.locator(".tl-scroll").boundingBox();
    const x = b.x + 412, y = b.y + b.height - 24;
    const frame = await page.evaluate((x) => {
      const el = document.querySelector(".tl-scroll");
      return Math.max(0, Math.round((x - el.getBoundingClientRect().left + el.scrollLeft - 112) / window.videoEditor.state().zoom));
    }, x);
    await page.mouse.click(x, y, { button: "right" });
    await page.locator(".ctx-anchor .menu").waitFor();
    return frame;
  };
  const frame = await open();
  details.emptyClipboard = { ok: await page.getByRole("menuitem", { name: /^Paste/ }).isDisabled() };
  const before = await page.evaluate(() => window.videoEditor.describe().markers.length);
  await page.getByRole("menuitem", { name: /^Add marker/ }).click();
  const markers = await page.evaluate(() => window.videoEditor.project().markers);
  details.marker = { ok: markers.length === before + 1 && markers.at(-1).frame === frame, frame, markers };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.markerUndo = { ok: await page.evaluate((n) => window.videoEditor.describe().markers.length === n, before) };

  await page.evaluate(() => {
    const ve = window.videoEditor;
    ve.exec("add_text", { text: "Copy me", start: 0, duration: 2 });
    ve.select(ve.project().tracks.flatMap((t) => t.clips.map((c) => c.id)));
    ve.action("copy");
  });
  const pasteFrame = await open();
  details.copiedClipboard = { ok: await page.getByRole("menuitem", { name: /^Paste/ }).isEnabled() };
  await page.getByRole("menuitem", { name: /^Paste/ }).click();
  const clips = await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips));
  details.paste = { ok: clips.length === 2 && clips.some((c) => c.start === pasteFrame), starts: clips.map((c) => c.start), pasteFrame };
  await open();
  await page.getByRole("menuitem", { name: /^Select all/ }).click();
  details.selectAll = { ok: await page.evaluate(() => window.videoEditor.state().selection.length === 2) };

  await page.locator(".clip").first().click({ button: "right" });
  details.clipMenu = { ok: await page.getByRole("menuitem", { name: /^Cut/ }).isVisible() };
  await page.keyboard.press("Escape");
  details.nativeTextMenu = { ok: await page.evaluate(() => {
    const input = document.createElement("input");
    document.querySelector(".tl-scroll").append(input);
    const native = input.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    input.remove();
    return native && !document.querySelector(".ctx-anchor");
  }) };
  await open();
  await page.getByRole("menuitem", { name: /^Add marker/ }).click();
  await page.locator(".tl-marker").click({ button: "right" });
  details.markerMenu = { ok: await page.evaluate(() => !document.querySelector(".ctx-anchor") && window.videoEditor.project().markers.length === 0) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
