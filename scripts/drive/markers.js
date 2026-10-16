// Search, navigation, exact edits, grouped undo and persistence of timeline notes.
async (page) => {
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("http://localhost:1420");
  await page.locator(".create-card").click();
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Markers", exact: true }).click();
  const panel = page.locator(".markers-tab"), details = {};
  details.empty = { ok: await panel.getByText(/Mark chapters, beats/).isVisible() };
  await panel.getByRole("button", { name: "Add marker", exact: true }).click();
  details.add = { ok: await page.evaluate(() => window.videoEditor.project().markers.length === 1 && window.videoEditor.project().markers[0].frame === 0) && await panel.getByRole("button", { name: "Save marker" }).isDisabled() };
  const ids = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("set_project", { name: "Marker panel drive" });
    v.exec("add_color_clip", { color: "#237f62", start: 2, duration: 5 });
    const intro = v.project().markers[0].id;
    v.exec("update_marker", { marker_id: intro, label: "Intro" });
    v.exec("add_marker", { at: 3, label: "Fix audio", color: "#ff6b75" });
    v.exec("add_marker", { at: 120, label: "Future chapter", color: "#ff6b75" });
    const clip = v.project().tracks[0].clips[0].id;
    v.select([clip]);
    return { intro, audio: v.project().markers[1].id, future: v.project().markers[2].id, clip, tracks: JSON.stringify(v.project().tracks) };
  });
  await panel.getByRole("button", { name: /^Go to Future chapter/ }).click();
  details.beyondEnd = { ok: await page.evaluate(() => window.videoEditor.state().playhead === 3600 && document.querySelector(".tl-scroll").scrollLeft > 0 && window.videoEditor.describe().duration === 7) };
  await panel.getByRole("textbox", { name: "Search markers" }).fill(" FIX ");
  details.search = { ok: await panel.locator(".marker-row").count() === 1 && await page.locator(".tl-marker").count() === 3 };
  await panel.getByRole("combobox", { name: "Filter markers by color" }).selectOption("#3be0f0");
  details.intersect = { ok: await panel.locator(".marker-row").count() === 0 && await panel.getByText(/No markers match/).isVisible() };
  await panel.getByRole("textbox", { name: "Search markers" }).fill("");
  details.colorFilter = { ok: await panel.locator(".marker-row").count() === 1 };
  await panel.getByRole("combobox", { name: "Filter markers by color" }).selectOption("");
  await panel.getByRole("textbox", { name: "Search markers" }).fill("00:00:03");
  details.timeSearch = { ok: await panel.locator(".marker-row").count() === 1 };
  await panel.getByRole("textbox", { name: "Search markers" }).fill("");
  await panel.getByRole("button", { name: /^Go to Intro/ }).click();
  await panel.getByRole("textbox", { name: "Marker note" }).fill("Discard this note");
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  details.cancel = { ok: await page.evaluate(id => window.videoEditor.project().markers.find(m => m.id === id).label === "Intro", ids.intro) };
  await panel.getByRole("button", { name: /^Go to Intro/ }).click();
  await panel.getByRole("textbox", { name: "Marker note" }).fill("Opening card");
  await panel.getByRole("textbox", { name: "Marker position" }).fill("bad time");
  details.invalid = { ok: await panel.getByRole("button", { name: "Save marker" }).isDisabled() && await panel.getByRole("textbox", { name: "Marker position" }).getAttribute("aria-invalid") === "true" };
  await panel.getByRole("textbox", { name: "Marker position" }).fill("1.25s");
  await panel.getByRole("button", { name: "Purple", exact: true }).click();
  await panel.getByRole("button", { name: "Save marker" }).click();
  details.edit = { ok: await page.evaluate(id => {
    const m = window.videoEditor.project().markers.find(m => m.id === id);
    return m.label === "Opening card" && m.frame === 38 && m.color === "#bf8cff" && window.videoEditor.state().playhead === 38;
  }, ids.intro) };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undoTogether = { ok: await page.evaluate(id => {
    const m = window.videoEditor.project().markers.find(m => m.id === id);
    return m.label === "Intro" && m.frame === 0 && m.color === "#3be0f0";
  }, ids.intro) };
  await page.evaluate(() => window.videoEditor.action("redo"));
  await panel.getByRole("button", { name: "Next marker", exact: true }).click();
  details.next = { ok: await page.evaluate(() => window.videoEditor.state().playhead === 90) };
  await panel.getByRole("button", { name: "Previous marker", exact: true }).click();
  details.previous = { ok: await page.evaluate(() => window.videoEditor.state().playhead === 38) };
  await page.getByRole("tab", { name: "Media", exact: true }).click();
  await page.locator('.tl-marker[aria-label="Fix audio"]').dblclick();
  details.rulerEditor = { ok: await panel.isVisible() && await panel.getByRole("textbox", { name: "Marker note" }).inputValue() === "Fix audio" };
  await panel.getByRole("button", { name: "Delete Fix audio", exact: true }).click();
  details.delete = { ok: await page.evaluate(id => !window.videoEditor.project().markers.some(m => m.id === id), ids.audio) };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undoDelete = { ok: await page.evaluate(id => window.videoEditor.project().markers.some(m => m.id === id), ids.audio) };
  await page.evaluate(() => window.videoEditor.seek(0));
  await page.locator('.tl-marker[aria-label="Fix audio"]').focus();
  await page.keyboard.press("Enter");
  details.keyboardRuler = { ok: await page.evaluate(() => window.videoEditor.state().playhead === 90) };
  details.clipSelection = { ok: await page.evaluate(id => window.videoEditor.state().selection[0] === id, ids.clip) };
  details.clipPositions = { ok: await page.evaluate(tracks => JSON.stringify(window.videoEditor.project().tracks) === tracks, ids.tracks) };
  await page.setViewportSize({ width: 1100, height: 680 });
  details.narrowFit = { ok: await panel.evaluate(el => el.scrollWidth <= el.clientWidth && [...el.querySelectorAll(".marker-toolbar button, .marker-search select, .marker-actions button")].every(b => {
    const r = b.getBoundingClientRect(), p = el.getBoundingClientRect();
    return r.left >= p.left && r.right <= p.right;
  })) };
  await page.waitForFunction(() => {
    const tab = document.querySelector(".lib-tab.on"), r = tab.getBoundingClientRect(), strip = tab.parentElement.getBoundingClientRect();
    return r.left >= strip.left && r.right <= strip.right + 1;
  });
  details.activeTabVisible = { ok: true };
  const controls = await panel.evaluate(el => [...el.querySelectorAll(".marker-toolbar button, .marker-search input, .marker-actions button")].map(b => {
    const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { name: b.getAttribute("aria-label") || b.textContent, y: r.y, height: r.height, hit: hit?.tagName + "." + hit?.className,
      ok: r.top >= 0 && r.bottom <= innerHeight && (b.disabled || b.contains(hit)) };
  }));
  details.controlsVisible = { ok: controls.every(c => c.ok), controls };
  await page.getByRole("region", { name: "Library", exact: true }).screenshot({ path: "scratch/markers.png", animations: "disabled" });
  await page.evaluate(() => window.videoEditor.action("saveProject"));
  await page.waitForFunction(() => document.querySelector(".save-state")?.textContent?.startsWith("Saved"));
  const saved = await page.evaluate(() => JSON.stringify(window.videoEditor.project().markers));
  await page.reload();
  await page.getByText("Marker panel drive", { exact: true }).click();
  await page.locator(".timeline-panel").waitFor();
  details.persistence = { ok: await page.evaluate(saved => JSON.stringify(window.videoEditor.project().markers) === saved, saved) };
  return { ok: Object.values(details).every(d => d.ok), details };
}
