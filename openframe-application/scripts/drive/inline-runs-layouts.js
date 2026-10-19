// Inline range pixels, every layout in both orientations, group geometry,
// and atomic undo, all edits through the same MCP surface agents use.
async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(8000);
  const details = {};
  const call = async (name, args = {}) => {
    const r = await page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
    if (r.error || r.result?.isError) throw new Error(`${name}: ${JSON.stringify(r)}`);
    return JSON.parse(r.result.content[0].text);
  };
  const clips = () => page.evaluate(() => window.videoEditor.project().tracks.flatMap(t => t.clips));
  const snapshot = () => page.evaluate(() => JSON.stringify(window.videoEditor.project().tracks));
  const bg = (await call("add_color_clip", { color: "#000000", start: 0, duration: 8 })).added_clips[0].id;
  const id = (await call("add_text", { text: "AI built in", start: 0, duration: 8, style: { size: 180, color: "#ffffff", weight: 400 } })).added_clips[0].id;
  const before = await snapshot();
  const styled = await call("style_text_range", { clip_id: id, match: "in", color: "#00ff00", weight: 800 });
  details.answerRuns = { ok: styled.changed_clips.some(c => c.id === id && c.runs?.[0]?.start === 9 && c.runs[0].end === 11), styled };
  await page.evaluate(async () => { const v = window.videoEditor; v.seek(30); await new Promise(r => setTimeout(r, 80)); await v.rendered(); });
  const pixels = await page.evaluate(() => {
    const { width, height, data } = window.videoEditor.pixels();
    let green = 0, white = 0, greenMin = width, whiteMax = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (g > 180 && r < 70 && b < 70) { green++; greenMin = Math.min(greenMin, x); }
      if (r > 180 && g > 180 && b > 180) { white++; whiteMax = Math.max(whiteMax, x); }
    }
    return { green, white, greenMin, whiteMax };
  });
  details.runPixels = { ok: pixels.green > 30 && pixels.white > 100 && pixels.greenMin > pixels.whiteMax, ...pixels };
  await call("undo"); details.runUndo = { ok: before === await snapshot() };
  await call("style_text_range", { clip_id: id, match: "in", color: "#00ff00", weight: 800 });
  await call("set_text", { clip_id: id, text: "The AI built in" });
  details.shifted = { ok: (await clips()).find(c => c.id === id).style.runs[0].start === 13 };
  await call("undo");
  await page.evaluate(id => window.videoEditor.select([id]), id);
  await page.locator(".tf-box").dblclick();
  await page.locator(".te-text").fill("The AI built in");
  await page.locator(".te-text").press("Escape");
  details.inlineTyping = { ok: (await clips()).find(c => c.id === id).style.runs[0].start === 13 };
  await call("undo");
  details.inlineUndo = { ok: (await clips()).find(c => c.id === id).text === "AI built in" && (await clips()).find(c => c.id === id).style.runs[0].start === 9 };
  // Mixed styles retain their shared kinetic unit during letter/word/line moves.
  for (const unit of ["letter", "word", "line"]) {
    await call("set_animation", { clip_id: id, slot: "in", type: "rise", unit, duration: 1 });
    await page.evaluate(async () => { const v = window.videoEditor; v.seek(28); await new Promise(r => setTimeout(r, 60)); await v.rendered(); });
    const count = await page.evaluate(() => { const p = window.videoEditor.pixels(); let n = 0; for(let i=0;i<p.data.length;i+=4) if(p.data[i+1]>100 && p.data[i]<70 && p.data[i+2]<70) n++; return n; });
    details[`kinetic-${unit}`] = { ok: count > 0, count };
    await call("undo");
  }
  await call("delete_clips", { clip_ids: [id, bg] });
  const ids = [];
  for (const color of ["#ff0000", "#00ff00", "#0000ff", "#ffff00"]) ids.push((await call("add_color_clip", { color, start: 0, duration: 8 })).added_clips[0].id);
  const layouts = ["split-vertical", "split-horizontal", "grid-2x2", "triptych", "pip-top-right", "pip-top-left", "pip-bottom-right", "pip-bottom-left", "pip-center-card"];
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    await call("set_project", { width, height });
    for (const layout of layouts) {
      for (const count of layout === "triptych" ? [3] : [2, 3, 4]) {
      const selected = ids.slice(0, count), before = await snapshot();
      await call("apply_layout", { clip_ids: selected, layout, gap: 0.02, margin: 0.04 });
      const actual = (await clips()).filter(c => selected.includes(c.id));
      const unit = Math.min(width, height), m = 0.04 * unit, gap = 0.02 * unit, w = width - 2*m, h = height - 2*m;
      const expected = selected.map((_, i) => {
        if (layout.startsWith("pip-")) {
          if (!i) return { x: 0, y: 0, w: width, h: height };
          const center = layout === "pip-center-card", cw = w*(center ? 0.64 : 0.32), total = h*(center ? 0.64 : 0.48), ch = (total-gap*(count-2))/(count-1);
          const top = center ? (height-total)/2 : layout.includes("bottom") ? height-m-total : m;
          return { x: center ? (width-cw)/2 : layout.endsWith("left") ? m : width-m-cw, y: top+(i-1)*(ch+gap), w: cw, h: ch };
        }
        const cols = layout === "split-horizontal" ? 1 : layout === "grid-2x2" ? 2 : count, rows = layout === "split-horizontal" ? count : layout === "grid-2x2" ? 2 : 1;
        const cw = (w-gap*(cols-1))/cols, ch = (h-gap*(rows-1))/rows;
        return { x: m+(i%cols)*(cw+gap), y: m+Math.floor(i/cols)*(ch+gap), w: cw, h: ch };
      });
      const errors = selected.map((id, i) => {
        const c = actual.find(c => c.id === id), e = expected[i];
        const w = width*c.transform.scale*(1-c.crop.left-c.crop.right), h = height*c.transform.scale*(1-c.crop.top-c.crop.bottom);
        return Math.max(Math.abs(w-e.w), Math.abs(h-e.h), Math.abs((c.transform.x+0.5)*width-w/2-e.x), Math.abs((c.transform.y+0.5)*height-h/2-e.y));
      });
      await call("undo");
      details[`${layout}-${count}-${width}x${height}`] = { ok: errors.every(e => e < 0.001) && before === await snapshot(), errors };
      }
    }
  }
  const preBorder = await snapshot();
  await call("apply_layout", { clip_ids: ids.slice(0,2), layout: "pip-top-right", border: { width: 4, color: "#ffffff" }, radius: 0.3, animate: "slide" });
  const bordered = await clips();
  details.layoutBorder = { ok: bordered.length === 5 && bordered.some(c=>c.name==="Layout border" && c.group && c.keyframes["transform.x"].length===2) };
  await call("undo"); details.layoutBorderUndo = { ok: preBorder === await snapshot() };
  await page.evaluate(ids => window.videoEditor.select(ids), ids.slice(0,2));
  await page.getByRole("button", { name: "split vertical", exact: true }).click();
  details.layoutTile = { ok: (await clips()).find(c=>c.id===ids[0]).transform.x < 0 && (await clips()).find(c=>c.id===ids[1]).transform.x > 0 };
  await call("undo"); details.layoutTileUndo = { ok: preBorder === await snapshot() };
  await call("apply_layout", { clip_ids: ids.slice(0, 2), layout: "split-vertical" });
  await call("group_clips", { clip_ids: ids.slice(0, 2) });
  const original = await clips(), a = original.find(c=>c.id===ids[0]), b = original.find(c=>c.id===ids[1]);
  const preGroup = await snapshot();
  await call("transform_group", { group_id: a.group, x: 0.1, y: -0.05, scale: 1.5, rotation: 90 });
  const after = await clips(), aa = after.find(c=>c.id===a.id), bb = after.find(c=>c.id===b.id);
  details.groupTransform = { ok: Math.abs((bb.transform.x-aa.transform.x)*1080 + (b.transform.y-a.transform.y)*1920*1.5) < 0.001 && Math.abs((bb.transform.y-aa.transform.y)*1920 - (b.transform.x-a.transform.x)*1080*1.5) < 0.001 && Math.abs(aa.transform.scale/a.transform.scale-1.5)<0.001 };
  await call("undo"); details.groupUndo = { ok: preGroup === await snapshot() };
  await call("transform_group", { clip_ids: ids.slice(0, 2), x: 0.1, at: 1 });
  details.groupKeys = { ok: (await clips()).filter(c => ids.slice(0,2).includes(c.id)).every(c => c.keyframes["transform.x"][0].f === 30) };
  await call("undo"); details.groupKeysUndo = { ok: preGroup === await snapshot() };
  await page.evaluate(ids => { window.videoEditor.select(ids); window.videoEditor.seek(30); }, ids.slice(0,2));
  const groupFrame = await page.locator(".tf-group").boundingBox();
  const knob = await page.locator(".tf-group .tf-rotate").boundingBox();
  const cx = groupFrame.x + groupFrame.width/2, cy = groupFrame.y + groupFrame.height/2;
  const kx = knob.x + knob.width/2, ky = knob.y + knob.height/2;
  const dx = kx-cx, dy = ky-cy, angle = Math.PI/4;
  await page.mouse.move(kx, ky); await page.mouse.down();
  await page.mouse.move(cx+dx*Math.cos(angle)-dy*Math.sin(angle), cy+dx*Math.sin(angle)+dy*Math.cos(angle), { steps: 5 });
  await page.mouse.up();
  details.groupHandle = { ok: (await clips()).filter(c=>ids.slice(0,2).includes(c.id)).every(c=>Math.abs(c.transform.rotation-45)<0.1) };
  await call("undo"); details.groupHandleUndo = { ok: preGroup === await snapshot() };
  // A position dot drags independently of the clip's transform box.
  await call("add_keyframe", { clip_id: ids[0], path: "transform.x", at: 0, value: -0.25 });
  await call("add_keyframe", { clip_id: ids[0], path: "transform.x", at: 2, value: 0.25 });
  await page.evaluate(id => { window.videoEditor.select([id]); window.videoEditor.seek(30); }, ids[0]);
  const beforePoint = await snapshot();
  await call("move_motion_point", { clip_id: ids[0], at: 2, x: 0.15, y: 0.1 });
  details.motionCommand = { ok: (await clips()).find(c => c.id === ids[0]).keyframes["transform.y"][0].v === 0.1 };
  await call("undo");
  details.motionCommandUndo = { ok: beforePoint === await snapshot() };
  const dot = page.getByRole("button", { name: "Motion point 2", exact: true });
  const point = await dot.boundingBox();
  const canvas = await page.locator(".player-canvas").boundingBox();
  const originalPoint = (await clips()).find(c => c.id === ids[0]);
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + point.width / 2 + 20, point.y + point.height / 2 + 15, { steps: 6 });
  await page.mouse.up();
  const movedPoint = (await clips()).find(c => c.id === ids[0]);
  details.motionDrag = { ok: Math.abs(movedPoint.keyframes["transform.x"].find(k=>k.f===60).v - 0.25 - 20/canvas.width) < 0.001 && Math.abs(movedPoint.keyframes["transform.y"].find(k=>k.f===60).v - originalPoint.transform.y - 15/canvas.height) < 0.001 };
  await call("undo"); details.motionDragUndo = { ok: beforePoint === await snapshot() };
  return { ok: Object.values(details).every(d => d.ok), details };
};
