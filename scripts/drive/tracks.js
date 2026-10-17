// Track header drive: Solo on an audio track's header, and the header's
// right-click menu (Rename, Solo, Track volume, height, Delete track);
// double-click renames too. Each edit is one undo step.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const t = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [wav] = await api.import([{ name: "voice-8s.wav", src: location.origin + "/fixtures/media/voice-8s.wav" }]);
    api.exec("add_color_clip", { color: "#305070", start: 0, duration: 4 });
    api.exec("add_media_clip", { asset_id: wav.id, start: 0 });
    return api.project().tracks.find((x) => x.kind === "audio").id;
  });
  const track = () => page.evaluate((id) => window.videoEditor.project().tracks.find((x) => x.id === id), t);
  // The audio row's header: the one with a Solo button.
  const header = page.locator(".tl-header", { has: page.getByRole("button", { name: /solo track/i }) });
  const details = {};

  await header.getByRole("button", { name: "Solo track" }).click();
  details.soloButton = { ok: (await track()).solo === true && (await header.getByRole("button", { name: "Unsolo track" }).count()) === 1 };
  await page.evaluate(() => window.videoEditor.action("undo"));

  const h0 = (await header.boundingBox()).height;
  await header.click({ button: "right", position: { x: 20, y: 10 } });
  await page.getByRole("menuitem", { name: "Large height" }).click();
  const h1 = (await header.boundingBox()).height;
  details.height = { ok: h1 > h0 * 1.5 && (await track()).height === "large", h0, h1 };

  await header.click({ button: "right", position: { x: 20, y: 10 } });
  await page.getByRole("menuitem", { name: "Rename track…" }).click();
  await page.getByRole("textbox", { name: "Track name" }).fill("Narration");
  await page.keyboard.press("Enter");
  details.rename = { ok: (await track()).name === "Narration" };
  await header.dblclick({ position: { x: 20, y: 10 } });
  await page.getByRole("textbox", { name: "Track name" }).fill("Ignored");
  await page.keyboard.press("Escape");
  details.renameEscape = { ok: (await track()).name === "Narration" };

  await header.click({ button: "right", position: { x: 20, y: 10 } });
  await page.getByRole("menuitem", { name: "Track volume…" }).click();
  const slider = page.getByRole("slider", { name: "Track volume" });
  await slider.focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowLeft"); // -6 dB
  const v = (await track()).volume;
  await page.keyboard.press("Escape");
  details.volume = { ok: Math.abs(v - 10 ** (-6 / 20)) < 0.01, volume: v };
  await page.evaluate(() => {
    for (let i = 0; i < 12; i++) window.videoEditor.action("undo");
  });
  // A drag is one undo step.
  await header.click({ button: "right", position: { x: 20, y: 10 } });
  await page.getByRole("menuitem", { name: "Track volume…" }).click();
  const box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width * 0.77, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const dragged = (await track()).volume;
  await page.screenshot({ path: "scratch/tracks.png" });
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.volumeUndo = { ok: dragged < 0.5 && (await track()).volume === 1, dragged };

  await header.click({ button: "right", position: { x: 20, y: 10 } });
  await page.getByRole("menuitem", { name: "Delete track" }).click();
  details.delete = { ok: (await track()) === undefined };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.deleteUndo = { ok: (await track())?.name === "Narration" };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
