// The inspector's Shape and Compositing sections (ADR-056 to ADR-059):
// a selected shape shows its shape rows; switching it to an ellipse, turning
// motion blur on, mirroring its edges and picking the track above as its
// matte each land in the project as an undo step, through the same
// commands agents use; the timeline names the clip after its shape.
// Compositing starts folded while a clip uses none of it.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(5000);
  const id = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("add_color_clip", { color: "#204060", start: 0, duration: 3 });
    v.exec("add_shape", { kind: "rounded_rectangle", start: 0, duration: 3, width: 0.4, height: 0.2, color: "#ff3d7f", stroke_width: 6 });
    // A title above the shape, for the track-above matte.
    v.exec("add_track", { kind: "video", name: "Top" });
    const top = v.project().tracks[0].id;
    v.exec("add_text", { text: "MATTE", start: 0, duration: 3, track_id: top, style: { size: 300 } });
    const id = v.project().tracks.flatMap((t) => t.clips).find((c) => c.shape).id;
    v.select([id]);
    v.seek(30);
    return id;
  });
  const details = {};
  const panel = page.getByRole("region", { name: "Inspector" }).or(page.locator(".inspector")).first();
  await panel.getByText("Shape", { exact: true }).first().waitFor();
  details.label = { ok: (await page.locator(".timeline-panel").getByText("Rounded rectangle").count()) > 0 };
  const clip = () => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id), id);
  await panel.getByRole("radio", { name: "Ellipse" }).click();
  details.kind = { ok: (await clip()).shape.kind === "ellipse" };
  await panel.getByRole("button", { name: "Compositing" }).click();
  await panel.getByRole("switch", { name: "Motion blur" }).click();
  details.motionBlur = { ok: (await clip()).motionBlur?.shutter === 180 };
  await panel.getByLabel("Edges").selectOption("mirror");
  details.edge = { ok: (await clip()).edge === "mirror" };
  await panel.getByLabel("Track matte").selectOption("above");
  await panel.getByLabel("Matte mode").selectOption("luma");
  const c = await clip();
  details.matte = { ok: c.trackMatte?.mode === "luma" && c.trackMatte.clipId === undefined, matte: c.trackMatte };
  const undo = await page.evaluate(() => window.videoEditor.state().undoLabel);
  details.undoLabel = { ok: undo === "Matte mode", undo };
  await page.waitForTimeout(300);
  await page.screenshot({ path: "__REPO__/scratch/graphics-inspector.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
