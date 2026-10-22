// Nested callouts follow their picture, tall burned captions clear rings,
// and tall end cards use their safe column. Render real stills as well as
// checking the project geometry; the master stays untouched.
async (page) => {
  page.setDefaultTimeout(180000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  return page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? r.result.content[0].text}`);
      return JSON.parse(r.result.content.at(-1).text);
    };
    const { versionProject, captionCollisions } = await import("/src/lib/versions.ts");
    const { calloutSpot } = await import("/src/lib/versionCallouts.ts");
    const { fittedSize } = await import("/src/lib/render/size.ts");
    const details = {};
    const [asset] = await ve.import([{ name: "h264-1080p30.mp4", src: `${location.origin}/fixtures/media/h264-1080p30.mp4` }]);
    const shot = (await call("add_media_clip", { asset_id: asset.id, start: 0, duration: 4 })).added_clips[0].id;
    await call("frame_region", { clip_id: shot, region: { x: 0.1, y: 0.1, w: 0.6, h: 0.6 } });
    const ring = (await call("add_shape", { kind: "ellipse", start: 0, duration: 4, x: -0.25, y: -0.1, width: 0.1, height: 0.12, fill: false, stroke_color: "#00ff00", stroke_width: 6 })).added_clips[0].id;
    const master = ve.project(), plain = versionProject(master, { ratio: "9:16" });
    await call("create_compound_clip", { clip_ids: [shot, ring], name: "Scene" });
    const nested = ve.project(), q = versionProject(nested, { ratio: "9:16" });
    const view = { ...q, tracks: q.compounds[0].tracks };
    const find = (p, id) => p.tracks.flatMap(t => t.clips).find(c => c.id === id);
    const a = calloutSpot(plain, find(plain, ring), "shape", 30), b = calloutSpot(view, find(view, ring), "shape", 30);
    details.compound = { ok: Math.abs(a.cx - b.cx) < 1 && Math.abs(a.cy - b.cy) < 1 && Math.abs(a.w - b.w) < 1, a, b };
    // Return to the root scene, replace its small ring with a tall ring.
    await call("undo");
    await call("delete_clips", { clip_ids: [ring] });
    const bottom = (await call("add_shape", { kind: "ellipse", start: 0, duration: 4, x: 0, y: 0.05, width: 0.3, height: 0.6, fill: false, stroke_color: "#00ff00", stroke_width: 6 })).added_clips[0].id;
    await call("add_captions", { captions: [{ text: "Lift the shadows", start: 0, end: 4 }] });
    const moved = [], tall = versionProject(ve.project(), { ratio: "9:16" }, undefined, undefined, undefined, moved);
    details.captions = { ok: !captionCollisions(tall).some(h => h.clip_id === bottom) && moved.some(h => h.clip_id === bottom && /captions.*above.*ring/.test(h.done)), moved };
    await call("set_project", { width: 1080, height: 1920 });
    await call("add_ad_element", { element: "end_card", start: 4, duration: 3, headline: "Fresh every morning", cta: "Order now", logo: "none" });
    const p = ve.project(), headline = p.tracks.flatMap(t => t.clips).find(c => c.type === "text" && c.text === "Fresh every morning");
    const size = fittedSize(p, headline), left = (0.5 + headline.transform.x) * p.width - size.w / 2, right = left + size.w;
    details.endCard = { ok: headline.style.size >= 72 && left >= 0.11 * p.width - 1 && right <= 0.81 * p.width + 1, size: headline.style.size, left, right };
    const still = await ve.still(165, "1080p");
    details.still = { ok: !!still.url };
    return { ok: Object.values(details).every(d => d.ok), details };
  });
};
