// A real 16:9 video with a red facecam rectangle on blue gameplay.
// Needs ffmpeg on PATH. Generates only this drive's fixture in scratch.
async (page) => {
  const fs = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  fs.mkdirSync("__REPO__/scratch", { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=640x360:r=30:d=4", "-vf", "drawbox=x=0:y=0:w=160:h=126:color=red:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", "__REPO__/scratch/stream-layout-source.mp4"]);
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  const call = (name, args = {}) => page.evaluate(async ([name, args]) => {
    const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    if (r.result?.isError || r.error) throw new Error(JSON.stringify(r));
    return JSON.parse(r.result.content[0].text);
  }, [name, args]);
  const origin = await page.evaluate(() => location.origin);
  const [a] = await call("import_media", { files: [{ src: `${origin}/scratch/stream-layout-source.mp4`, name: "Stream fixture.mp4" }] });
  const placed = await call("add_media_clip", { asset_id: a.id, start: 0, duration: 3 });
  const id = placed.added_clips[0].id;
  const snapshot = () => page.evaluate(() => JSON.stringify(window.videoEditor.project()));
  const before = await snapshot();
  const answer = await call("apply_stream_layout", { clip_id: id, facecam: { x: 0, y: 0, w: 0.25, h: 0.35 }, gameplay: { x: 0.25, y: 0, w: 0.75, h: 1 } });
  const details = {};
  details.canvasNote = { ok: JSON.stringify(answer).includes("1080x1920") };
  await page.evaluate(() => window.videoEditor.seek(15));
  await page.evaluate(() => window.videoEditor.rendered());
  const pixels = await page.evaluate(() => {
    const { width, height, data } = window.videoEditor.pixels();
    const at = (x, y) => Array.from(data.slice((Math.floor(y * height) * width + Math.floor(x * width)) * 4, (Math.floor(y * height) * width + Math.floor(x * width)) * 4 + 3));
    return { top: at(0.5, 0.15), topLeft: at(0.08, 0.15), bottom: at(0.5, 0.7) };
  });
  const red = c => c[0] > 190 && c[1] < 60 && c[2] < 60;
  const blue = c => c[2] > 190 && c[0] < 60 && c[1] < 60;
  details.viewer = { ok: red(pixels.top) && red(pixels.topLeft) && blue(pixels.bottom), ...pixels };
  const still = await page.evaluate(async () => {
    const r = await window.videoEditor.still(15, "480p");
    const blob = await (await fetch(r.url)).blob(); URL.revokeObjectURL(r.url);
    const bitmap = await createImageBitmap(blob), c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext("2d");
    g.drawImage(bitmap, 0, 0); bitmap.close();
    const px = (x, y) => Array.from(g.getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data.slice(0, 3));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { top: px(0.5, 0.15), bottom: px(0.5, 0.7), png: btoa(s) };
  });
  fs.writeFileSync("__REPO__/scratch/stream-layout-still.png", Buffer.from(still.png, "base64"));
  details.exportStill = { ok: red(still.top) && blue(still.bottom), top: still.top, bottom: still.bottom };
  await call("split", { clip_ids: [id], at: 1.5 });
  const split = await page.evaluate(() => window.videoEditor.project().tracks.flatMap(t => t.clips));
  details.split = { ok: split.length === 4 && new Set(split.filter(c => c.start === 45).map(c => c.group)).size === 1 && split[0].group !== split.find(c => c.start !== split[0].start).group };
  await call("undo"); await call("undo");
  details.undo = { ok: before === await snapshot() };
  // The human entry uses the viewer's existing crop handles before applying.
  await page.evaluate(id => window.videoEditor.select([id]), id);
  await page.getByRole("tab", { name: "Layouts", exact: true }).click();
  await page.getByRole("button", { name: "Stream: facecam over gameplay", exact: true }).click();
  await page.locator(".crop-rect").waitFor();
  details.facecamPicker = { ok: await page.getByRole("button", { name: "Apply stream layout", exact: true }).isVisible() };
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  details.pickerCancel = { ok: before === await snapshot() };
  return { ok: Object.values(details).every(d => d.ok), details };
}
