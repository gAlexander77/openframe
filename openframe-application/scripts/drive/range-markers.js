async (page) => {
  const fs = await import("node:fs"), path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  await page.goto("http://localhost:1420"); await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click(); await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(() => {
    const ve = window.videoEditor;
    ve.exec("add_color_clip", { color: "#123456", start: 0, duration: 4 });
    ve.exec("add_marker", { at: 0, label: "Intro", duration: 1 });
    return ve.project().markers[0].id;
  });
  const details = {};
  await page.locator(".tl-marker").first().dblclick();
  await page.getByRole("textbox", { name: "Marker duration", exact: true }).fill("1.5s");
  await page.getByRole("switch", { name: "Chapter", exact: true }).check();
  await page.getByRole("button", { name: "Save marker", exact: true }).click();
  details.editor = { ok: await page.evaluate((id) => {
    const m = window.videoEditor.project().markers.find((m) => m.id === id); return m.duration === 45 && m.chapter === true;
  }, id) };
  const handle = page.getByRole("button", { name: "Resize Intro range end", exact: true });
  const b = await handle.boundingBox(), zoom = await page.evaluate(() => window.videoEditor.state().zoom);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 15 * zoom, b.y + b.height / 2, { steps: 5 }); await page.mouse.up();
  details.drag = { ok: await page.evaluate((id) => window.videoEditor.project().markers.find((m) => m.id === id).duration === 60, id) };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undo = { ok: await page.evaluate((id) => window.videoEditor.project().markers.find((m) => m.id === id).duration === 45, id) };
  await page.evaluate(() => {
    const ve = window.videoEditor;
    ve.exec("add_marker", { at: 1, label: "Just a note" });
    ve.exec("add_marker", { at: 2, label: "Finish", chapter: true });
    ve.action("export");
  });
  await page.getByRole("checkbox", { name: "Chapters from markers", exact: true }).check();
  details.exportOption = { ok: await page.getByRole("checkbox", { name: "Chapters from markers", exact: true }).isChecked() };
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).last().click();
  const render = async (chapters) => page.evaluate(async (chapters) => {
    const r = await window.videoEditor.render({ format: "mp4", resolution: "480p", audio: false, chapters });
    const bytes = new Uint8Array(await (await fetch(r.url)).arrayBuffer()); URL.revokeObjectURL(r.url);
    let str = ""; for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(str);
  }, chapters);
  fs.mkdirSync("scratch", { recursive: true });
  for (const enabled of [true, false]) {
    const file = path.resolve(`scratch/range-markers-${enabled}.mp4`);
    fs.writeFileSync(file, Buffer.from(await render(enabled), "base64"));
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_chapters", "-show_streams", "-of", "json", file], { encoding: "utf8" }));
    const chapters = probe.chapters ?? [];
    details[enabled ? "chapters" : "optionOff"] = { ok: enabled ? chapters.length === 2 && Number(chapters[0].start_time) === 0 && chapters[0].tags.title === "Intro" && Number(chapters[1].start_time) === 2 && chapters[1].tags.title === "Finish" : chapters.length === 0, chapters, file };
  }
  return { ok: Object.values(details).every((d) => d.ok), details };
}
