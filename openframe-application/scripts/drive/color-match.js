async (page) => {
  await page.goto("http://localhost:1420");
  await page.locator(".create-card").click();
  await page.waitForFunction(() => !!window.videoEditor);
  const ids = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [asset] = await ve.import([{ name: "color-bars.png", src: location.origin + "/fixtures/media/color-bars.png" }]);
    ve.exec("add_media_clip", { asset_id: asset.id, start: 0, duration: 2 });
    ve.exec("add_media_clip", { asset_id: asset.id, start: 2, duration: 2 });
    ve.exec("add_media_clip", { asset_id: asset.id, start: 4, duration: 2 });
    const ids = ve.project().tracks.flatMap(t => t.clips).map(c => c.id);
    ve.exec("set_param", { clip_ids: [ids[0]], path: "adjust.temperature", value: 12 });
    ve.exec("set_param", { clip_ids: ids.slice(1), path: "adjust.temperature", value: -35 });
    ve.exec("set_curve", { clip_id: ids[1], channel: "r", points: [[0, 0], [0.5, 0.38], [1, 1]] });
    ve.select([ids[1]]);
    ve.seek(70);
    await ve.rendered();
    return ids;
  });
  await page.getByRole("tab", { name: "Adjust", exact: true }).click();
  await page.getByRole("button", { name: "Pick reference", exact: true }).click();
  await page.keyboard.press("Escape");
  const canceled = await page.getByRole("button", { name: "Pick reference", exact: true }).isVisible();
  await page.getByRole("button", { name: "Pick reference", exact: true }).click();
  await page.locator(`[data-clip="${ids[0]}"] .clip-label`).click();
  const pick = await page.evaluate(ids => ({ reference: window.videoEditor.state().colorMatchReference, selected: window.videoEditor.state().selection, ids }), ids);
  const details = {
    referencePicker: { ok: canceled && pick.reference === ids[0] && pick.selected[0] === ids[1], ...pick },
  };
  const matched = await page.evaluate(async ids => {
    const ve = window.videoEditor;
    const call = async (name, args) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.result.isError) throw new Error(r.result.content[0].text);
      return r.result;
    };
    const mean = async at => {
      const r = await call("preview_frame", { at, max_width: 160 });
      const bmp = await createImageBitmap(await (await fetch("data:image/png;base64," + r.content[0].data)).blob());
      try {
        const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        const data = g.getImageData(0, 0, bmp.width, bmp.height).data;
        return [0, 1, 2].map(k => { let s = 0; for (let i = k; i < data.length; i += 4) s += data[i]; return s / (data.length / 4); });
      } finally { bmp.close(); }
    };
    const clips = () => ve.project().tracks.flatMap(t => t.clips).filter(c => ids.slice(1).includes(c.id));
    const original = JSON.stringify(clips());
    const ref = await mean(0.5), old = await mean(2.5);
    const report = await call("match_color", { reference_clip_id: ids[0], clip_ids: ids.slice(1), match_saturation: true });
    const after = await mean(2.5), first = JSON.stringify(clips().map(c => c.adjust));
    const note = JSON.parse(report.content[0].text);
    ve.action("undo");
    const undo = JSON.stringify(clips()) === original;
    ve.action("redo");
    await call("match_color", { reference_clip_id: ids[0], clip_ids: ids.slice(1) });
    const converges = JSON.stringify(clips().map(c => c.adjust)) === first;
    const second = JSON.stringify(ve.project());
    await call("match_color", { reference_clip_id: ids[0], clip_ids: ids.slice(1), strength: 0 });
    const zero = JSON.stringify(ve.project()) === second;
    const distance = a => Math.max(...ref.map((v, k) => Math.abs(v - a[k])));
    return { ref, old, after, oldDistance: distance(old), distance: distance(after), undo, converges, zero, note };
  }, ids);
  details.pixels = { ok: matched.distance < 4 && matched.distance < matched.oldDistance, ...matched };
  details.oneUndo = { ok: matched.undo };
  details.repeat = { ok: matched.converges && matched.zero };
  await page.evaluate(ids => window.videoEditor.select(ids.slice(1)), ids);
  await page.getByRole("button", { name: "Match", exact: true }).click();
  await page.waitForFunction(() => !window.videoEditor.state().colorMatchBusy);
  details.multiInspector = { ok: await page.getByRole("button", { name: "Match", exact: true }).isEnabled() };
  return { ok: Object.values(details).every(d => d.ok), details };
}
