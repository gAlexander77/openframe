// Linked picture and sound (Premiere's linked clips, for J and L cuts):
// Extract audio links the video and its sound, so a click on either
// selects both and a move carries both. Alt-click picks the sound alone,
// and dragging it then puts the pair out of sync, which both clips show as
// red frame counts. Trimming the sound's tail alone (an L-cut's other
// half) leaves the picture and the sync as they are.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const v = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [m] = await api.import([{ name: "talk-gaps.mp4", src: location.origin + "/fixtures/media/talk-gaps.mp4" }]);
    api.exec("add_media_clip", { asset_id: m.id, start: 0, duration: 4 });
    const c = api.project().tracks.flatMap((t) => t.clips)[0];
    api.select([c.id]);
    return c.id;
  });
  await page.getByRole("region", { name: "Inspector" }).getByRole("tab", { name: "Audio", exact: true }).click();
  await page.getByRole("button", { name: "Extract audio" }).click();
  const a = await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "audio").id);
  const details = {};
  const sel = () => page.evaluate(() => window.videoEditor.state().selection.slice().sort().join());
  const clipOf = (id) => page.locator(`[data-clip="${id}"]`);
  const drag = async (id, dx, part = "body") => {
    const b = await clipOf(id).boundingBox();
    // By the label strip: a selected sound clip's volume line runs
    // through its middle and would take the drag.
    const x = part === "end" ? b.x + b.width - 2 : b.x + b.width / 2;
    const y = b.y + 7;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 4 });
    await page.mouse.move(x + dx, y, { steps: 4 });
    await page.mouse.up();
  };
  const read = () => page.evaluate(([v, a]) => {
    const all = window.videoEditor.project().tracks.flatMap((t) => t.clips);
    const V = all.find((c) => c.id === v), A = all.find((c) => c.id === a);
    return { v: [V.start, V.duration], a: [A.start, A.duration], badges: [...document.querySelectorAll(".clip-badge.sync")].map((e) => e.textContent) };
  }, [v, a]);

  await page.evaluate(() => window.videoEditor.select([]));
  await clipOf(a).click();
  details.linkedSelect = { ok: (await sel()) === [v, a].sort().join() };

  // Both are selected now; Alt-click narrows to the sound, and a drag
  // then leaves the picture where it is.
  await page.keyboard.down("Alt");
  await clipOf(a).click({ position: { x: 30, y: 7 } });
  await page.keyboard.up("Alt");
  details.altPicksOne = { ok: (await sel()) === a };
  await drag(a, 60);
  const moved = await read();
  details.outOfSync = { ok: moved.a[0] > 0 && moved.v[0] === 0 && moved.badges.length === 2 && moved.badges.some((t) => t.startsWith("+")) && moved.badges.some((t) => t.startsWith("−")), ...moved };
  await page.screenshot({ path: "__REPO__/scratch/linked-audio.png" });
  await page.keyboard.press("Control+z");

  await page.keyboard.down("Alt");
  await clipOf(a).click({ position: { x: 30, y: 7 } });
  await page.keyboard.up("Alt");
  await drag(a, -80, "end");
  const trimmed = await read();
  details.tailAlone = { ok: trimmed.a[1] < trimmed.v[1] && trimmed.v[1] === 120 && trimmed.badges.length === 0, ...trimmed };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
