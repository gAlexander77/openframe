// A 16:9 film laid out side by side, made through MCP, then export_versions
// for 9:16 and 4:5 (ADR-091): a floating window on the left with its
// headline on the right (a glow behind the window, a shadow under it, a
// slide in), then the mirror image, a split screen made by apply_layout
// with a label on each half, an end card, and captions on a hidden track.
// check: true answers the contact sheet (scratch/versions-stack-sheet.jpg).
// Then each version's project (lib/versions.ts, what export_versions
// renders), measured with the engine's own text layout: every window sits
// above its headline without touching it, the split screen's halves are
// stacked and wider than tall, every label on its half, the captions
// burned in below the stacks, and check_project finds nothing in the
// layout (title safe, the apps' buttons, text size). The project in the
// editor is left as it was.
async (page) => {
  const fs = await import("node:fs");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(20000);
  const details = {};
  const mcp = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const call = async (name, args) => {
    const r = await mcp(name, args);
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    return r.result.content;
  };
  const json = async (name, args) => JSON.parse((await call(name, args))[0].text);
  const origin = await page.evaluate(() => location.origin);

  await call("set_project", { width: 1920, height: 1080, name: "Side by side" });
  const [ui, cam, music] = await json("import_media", { files: ["framecode-30.mp4", "person-pan.mp4", "music-30s.mp3"].map((n) => ({ src: `${origin}/fixtures/media/${n}` })) });
  await call("add_color_clip", { color: "#05060a", start: 0, duration: 12 });
  await call("add_media_clip", { asset_id: music.id, start: 0, duration: 12 });
  const id = (r, type) => r.added_clips.find((c) => !type || c.type === type).id;
  // Window A on the left, a glow behind it, its headline on the right.
  const glow = id(await json("add_shape", { kind: "ellipse", start: 0, duration: 3, x: -0.22, width: 0.5, height: 0.62, gradient: { kind: "radial", from: "#6a5cffcc", to: "transparent" } }));
  const trackA = (await json("add_track", { kind: "video", name: "Windows" })).added_tracks[0].id;
  const winA = id(await json("add_media_clip", { asset_id: ui.id, start: 0, duration: 3, track_id: trackA }));
  await call("batch", {
    commands: [
      { command: "set_param", args: { clip_ids: [winA], path: "transform.scale", value: 0.45 } },
      { command: "add_keyframe", args: { clip_id: winA, path: "transform.x", at: 0, value: -0.75, ease: "fastIn" } },
      { command: "add_keyframe", args: { clip_id: winA, path: "transform.x", at: 0.5, value: -0.22 } },
      { command: "set_shadow", args: { clip_ids: [winA], blur: 60, y: 20, opacity: 0.6 } },
      { command: "add_text", args: { text: "Every edit is a tool.", start: 0, duration: 3, x: 0.25, style: { size: 96, bold: true, maxWidth: 0.38 } } },
    ],
  });
  // Window B on the right, its headline on the left.
  const winB = id(await json("add_media_clip", { asset_id: ui.id, start: 3, duration: 3, in: 3, track_id: trackA }));
  await call("batch", {
    commands: [
      { command: "set_param", args: { clip_ids: [winB], path: "transform.scale", value: 0.45 } },
      { command: "set_param", args: { clip_ids: [winB], path: "transform.x", value: 0.22 } },
      { command: "set_shadow", args: { clip_ids: [winB], blur: 60, y: 20, opacity: 0.6 } },
      { command: "add_text", args: { text: "Agents call every one by name.", start: 3, duration: 3, x: -0.25, style: { size: 96, bold: true, maxWidth: 0.38 } } },
    ],
  });
  // A split screen, a label on each half (written first, as the film did:
  // the layout keeps them on top).
  const left = (await json("add_track", { kind: "video", name: "Left" })).added_tracks[0].id;
  const right = (await json("add_track", { kind: "video", name: "Right" })).added_tracks[0].id;
  const halfL = id(await json("add_media_clip", { asset_id: cam.id, start: 6, duration: 3, track_id: left }));
  const halfR = id(await json("add_media_clip", { asset_id: ui.id, start: 6, duration: 3, in: 6, track_id: right }));
  const labels = (await json("add_track", { kind: "video", name: "Labels" })).added_tracks[0].id;
  await call("add_text", { text: "Before", start: 6, duration: 3, x: -0.242, y: -0.38, track_id: labels, style: { size: 56, bold: true, background: { color: "#000000aa" } } });
  const labels2 = (await json("add_track", { kind: "video", name: "Labels 2" })).added_tracks[0].id;
  await call("add_text", { text: "After", start: 6, duration: 3, x: 0.258, y: -0.38, track_id: labels2, style: { size: 56, bold: true, background: { color: "#000000aa" } } });
  await call("apply_layout", { clip_ids: [halfL, halfR], layout: "split-vertical", radius: 0.06 });
  await call("add_ad_element", { element: "end_card", start: 9, duration: 3, headline: "OpenFrame", cta: "Free download" });
  const caps = await json("add_captions", {
    captions: [
      { start: 0.2, end: 2.8, text: "Every edit in OpenFrame is a tool" },
      { start: 3.2, end: 5.8, text: "that an agent can call by name" },
      { start: 6.2, end: 8.8, text: "before and after, side by side" },
      { start: 9.2, end: 11.8, text: "free, on your own computer" },
    ],
  });
  await call("update_track", { track_id: caps.added_tracks[0].id, hidden: true });
  const before = await page.evaluate(() => ({ project: JSON.stringify(window.videoEditor.project()), undo: window.videoEditor.state().undoLabel }));

  // ---- look ------------------------------------------------------------------------
  const master = await call("preview_frames", { times: [2, 4.5, 7.5, 10.5], tile_width: 400, columns: 4 });
  fs.mkdirSync("__REPO__/scratch", { recursive: true });
  fs.writeFileSync("__REPO__/scratch/versions-stack-master.jpg", Buffer.from(master[0].data, "base64"));
  const sheet = await call("export_versions", { ratios: ["9:16", "4:5", "1:1"], check: true, check_at: [2 / 12, 4.5 / 12, 7.5 / 12, 10.5 / 12] });
  fs.writeFileSync("__REPO__/scratch/versions-stack-sheet.jpg", Buffer.from(sheet[0].data, "base64"));
  details.sheet = { ok: sheet[0].type === "image" && JSON.parse(sheet[1].text).versions === 3 };

  // ---- measure, with the engine's text layout ------------------------------------------
  const measured = await page.evaluate(async ({ ids }) => {
    const loaded = performance.getEntriesByType("resource").map((e) => e.name);
    const mod = (path) => import(loaded.find((n) => new URL(n).pathname === path) ?? path);
    const { versionProject, boxOf } = await mod("/src/lib/versions.ts");
    const { checkProject } = await mod("/src/lib/designCheck.ts");
    const master = window.videoEditor.project();
    const all = (q) => q.tracks.flatMap((t) => t.clips);
    const byId = (q, id) => all(q).find((c) => c.id === id);
    const byText = (q, t) => all(q).find((c) => c.type === "text" && c.text === t);
    const at = (q, c, s) => boxOf(q, c, Math.round(s * 30) - c.start);
    const r = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v)]));
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const within = (b, o) => b.left >= o.left - 1 && b.right <= o.right + 1 && b.top >= o.top - 1 && b.bottom <= o.bottom + 1;
    return ["9:16", "4:5", "1:1"].map((ratio) => {
      const q = versionProject(master, { ratio, captions: "burn" });
      const tall = q.height > q.width;
      const capTrack = q.tracks.find((t) => t.clips.some((c) => c.type === "text" && c.caption));
      const capAt = (s) => boxOf(q, all(q).find((c) => c.type === "text" && c.caption && c.start <= s * 30 && s * 30 < c.start + c.duration));
      const pairs = [[ids.winA, "Every edit is a tool.", 2], [ids.winB, "Agents call every one by name.", 4.5]].map(([win, text, s]) => {
        const w = at(q, byId(q, win), s), h = at(q, byText(q, text), s), cap = capAt(s);
        // Tall: the window above its headline; square: still side by side, apart.
        return { text, window: r(w), headline: r(h), caption: r(cap), apart: !overlap(w, h) && (!tall || w.bottom <= h.top + 0.5), clearOfCaption: !tall || cap.top >= h.bottom };
      });
      const L = at(q, byId(q, ids.halfL), 7.5), R = at(q, byId(q, ids.halfR), 7.5);
      const labels = [["Before", L], ["After", R]].map(([t, cell]) => within(at(q, byText(q, t), 7.5), cell));
      const layout = checkProject(q).findings.filter((f) => ["text_outside_title_safe", "text_under_app_buttons", "text_too_small"].includes(f.rule)).map((f) => `${f.rule}: ${f.message}`);
      const glow = at(q, byId(q, ids.glow), 2), win = at(q, byId(q, ids.winA), 2);
      return {
        ratio,
        size: `${q.width}x${q.height}`,
        pairs,
        split: { left: r(L), right: r(R), apart: !overlap(L, R) && (!tall || L.bottom <= R.top + 0.5), wide: !tall || ((L.right - L.left) / (L.bottom - L.top) > 1 && (R.right - R.left) / (R.bottom - R.top) > 1), labels },
        // The end card above the burned captions.
        card: all(q).filter((c) => c.name === "End card" && c.type === "text").every((c) => !tall || at(q, c, 11.5).bottom <= capAt(11.5).top + 0.5),
        glowOnWindow: Math.abs((glow.left + glow.right) / 2 - (win.left + win.right) / 2) < 20 && Math.abs((glow.top + glow.bottom) / 2 - (win.top + win.bottom) / 2) < 20,
        captionsShown: capTrack && !capTrack.hidden,
        layout,
      };
    });
  }, { ids: { winA, winB, halfL, halfR, glow } });
  for (const m of measured) {
    details[m.ratio] = {
      ok: m.pairs.every((p) => p.apart && p.clearOfCaption) && m.split.apart && m.split.wide && m.split.labels.every(Boolean) && m.card && m.glowOnWindow && m.captionsShown && m.layout.length === 0,
      ...m,
    };
  }
  // Stills of the tall versions, large enough to judge by eye.
  const stills = await page.evaluate(async () => {
    const loaded = performance.getEntriesByType("resource").map((e) => e.name);
    const mod = (path) => import(loaded.find((n) => new URL(n).pathname === path) ?? path);
    const { versionProject } = await mod("/src/lib/versions.ts");
    const { exportStill } = await mod("/src/engine/export.ts");
    const out = {};
    for (const ratio of ["9:16", "4:5", "1:1"]) {
      const q = versionProject(window.videoEditor.project(), { ratio });
      for (const s of [2, 4.5, 7.5, 10.5]) {
        const blob = await exportStill(q, Math.round(s * 30), Math.round((480 * q.width) / q.height), 480);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let b = "";
        for (let i = 0; i < bytes.length; i += 0x8000) b += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        out[`${ratio.replace(":", "x")}-${s}s`] = btoa(b);
      }
    }
    return out;
  });
  fs.mkdirSync("__REPO__/scratch/versions-stack", { recursive: true });
  for (const [name, b64] of Object.entries(stills)) fs.writeFileSync(`__REPO__/scratch/versions-stack/${name}.png`, Buffer.from(b64, "base64"));
  const after = await page.evaluate(() => ({ project: JSON.stringify(window.videoEditor.project()), undo: window.videoEditor.state().undoLabel }));
  details.untouched = { ok: after.project === before.project && after.undo === before.undo };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
