async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("add_color_clip", { color: "#ff0000", start: 0, duration: 3 });
    const id = v.project().tracks.flatMap((t) => t.clips)[0].id;
    v.seek(15); v.select([id]); return id;
  });
  const dial = page.getByRole("slider", { name: "Rotate", exact: true });
  await dial.waitFor();
  // The inspector settles for about 0.1 s after a selection; a pixel's
  // shift moves this 12 px drag radius several degrees.
  let box = await dial.boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(50);
    const now = await dial.boundingBox();
    if (now.x === box.x && now.y === box.y) break;
    box = now;
  }
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, radius = box.width * 0.35;
  await page.mouse.move(cx + radius, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    const a = i / 12 * Math.PI / 2;
    await page.mouse.move(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
  }
  await page.mouse.up();
  const rotation = () => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).transform.rotation, id);
  const turned = await rotation();
  await page.evaluate(() => window.videoEditor.action("undo"));
  const undone = await rotation();
  const details = { quarterTurn: { ok: Math.abs(turned - 90) < 1, turned }, oneUndo: { ok: undone === 0, undone } };
  // Releasing the snap modifier during a drag must keep that gesture open.
  await page.mouse.move(cx + radius, cy); await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(cx + Math.cos(31 * Math.PI / 180) * radius, cy + Math.sin(31 * Math.PI / 180) * radius, { steps: 8 });
  const snapped = await rotation();
  await page.keyboard.up("Shift");
  await page.mouse.move(cx + Math.cos(40 * Math.PI / 180) * radius, cy + Math.sin(40 * Math.PI / 180) * radius, { steps: 4 });
  await page.mouse.up();
  const released = await rotation();
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.snapModifier = { ok: snapped === 30 && Math.abs(released - 40) < 1 && await rotation() === 0, snapped, released };
  const field = page.getByRole("textbox", { name: "Rotate value", exact: true });
  await field.fill("370"); await field.press("Enter");
  details.multiTurn = { ok: await rotation() === 370 };
  await dial.focus(); await dial.press("ArrowUp"); await dial.press("Shift+ArrowRight");
  details.arrows = { ok: await rotation() === 381 };
  // The same row retains its keyframe diamond.
  await dial.locator("..").getByRole("button", { name: "Add keyframe", exact: true }).click();
  await dial.press("ArrowUp");
  const key = await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).keyframes["transform.rotation"], id);
  details.keyframing = { ok: key.some((k) => k.f === 15 && k.v === 382), key };
  await dial.dblclick();
  details.reset = { ok: +(await dial.getAttribute("aria-valuenow")) === 0 };
  return { ok: Object.values(details).every((d) => d.ok), details };
}
