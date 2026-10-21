// A 6-second ad opener built only through MCP (window.videoEditor.mcp,
// JSON-RPC tools/call), as an agent would build it (ADR-056 to ADR-060):
// 0-2.5 s  logo reveal: the footage plays inside a huge "BOLD" (a track
//          matte), pushing in, over a dark ground; a gradient underline
//          draws on beneath it.
// 2-2.5 s  a slanted wipe (a rotated rectangle as the next shot's matte,
//          moving fast with motion blur) reveals the full shot, which has
//          a light camera shake (wiggle) with mirrored edges.
// 2.7-6 s  lower third: a dark pill springs in (motion blur), an accent
//          line draws on, name and role rise in.
// 4-6 s    CTA: a gradient pill pops in elastically, "SHOP NOW" on it, and
//          an outline circle draws itself around it.
// Then preview_frames, saved to scratch/graphics-sheet.png to look at.
async (page) => {
  const fs = await import("node:fs");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  page.setDefaultTimeout(10000);
  const calls = [];
  /** One MCP tools/call; a tool error fails the drive with its message. */
  const call = async (name, args = {}) => {
    const r = await page.evaluate(
      ({ name, args, id }) => window.videoEditor.mcp({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
      { name, args, id: calls.length + 1 },
    );
    calls.push(name);
    if (r.error) throw new Error(`${name}: ${r.error.message}`);
    if (r.result.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    const c = r.result.content[0];
    return c.type === "text" ? JSON.parse(c.text) : c;
  };
  const clipOf = (r) => r.added_clips[0].id;
  const track = async (name) => (await call("add_track", { kind: "video", name })).added_tracks[0].id;
  const key = (clip_id, path, at, value, ease) => ({ command: "add_keyframe", args: { clip_id, path, at, value, ...(ease ? { ease } : {}) } });

  await call("new_project", { name: "Graphics drive" });
  await call("set_project", { width: 1920, height: 1080, background: "#000000" });
  const origin = await page.evaluate(() => location.origin);
  const [footage] = await call("import_media", { files: [{ src: `${origin}/fixtures/media/person-pan.mp4` }] });
  const main = (await call("describe_project")).tracks.find((t) => t.main).id;

  // ---- the logo reveal: footage inside the word ----
  const ground = clipOf(await call("add_color_clip", { color: "#0b0d12", start: 0, duration: 2.5, track_id: main }));
  const revealTrack = await track("Reveal");
  const inside = clipOf(await call("add_media_clip", { asset_id: footage.id, start: 0, duration: 2.5, in: 0, track_id: revealTrack }));
  const titleTrack = await track("Title");
  const word = clipOf(await call("add_text", { text: "BOLD", start: 0, duration: 2.5, y: -0.03, style: { size: 620, font: "Impact", bold: false, color: "#ffffff" }, track_id: titleTrack }));
  await call("set_track_matte", { clip_id: inside, matte_clip_id: word, mode: "alpha" });
  // The footage is pushed in a little so the face fills the letters.
  await call("batch", {
    commands: [
      { command: "set_param", args: { clip_ids: [inside], path: "transform.scale", value: 1.25 } },
      key(word, "transform.scale", 0, 0.86, "easeOut"),
      key(word, "transform.scale", 2.5, 1.0),
      { command: "set_animation", args: { clip_id: word, slot: "in", type: "blurIn", duration: 0.5 } },
    ],
  });
  const underTrack = await track("Underline");
  const underline = clipOf(await call("add_shape", { kind: "line", start: 0.3, duration: 2.2, y: 0.27, width: 0.5, stroke_width: 12, gradient: { from: "#ffcc00", to: "#ff3d7f", angle: 0 }, draw: 0, track_id: underTrack }));
  await call("batch", { commands: [key(underline, "shape.draw", 0.3, 0, "easeOut"), key(underline, "shape.draw", 1.0, 1)] });

  // ---- the wipe into the full shot, with a camera shake ----
  const shotTrack = await track("Shot");
  const shot = clipOf(await call("add_media_clip", { asset_id: footage.id, start: 2, duration: 4, in: 2, track_id: shotTrack }));
  const wipeTrack = await track("Wipe");
  const wipe = clipOf(await call("add_shape", { kind: "rectangle", start: 2, duration: 4, width: 1.6, height: 1.9, rotation: 12, x: -1.7, color: "#ffffff", track_id: wipeTrack }));
  await call("batch", {
    commands: [
      key(wipe, "transform.x", 2.0, -1.7, "easeInOut"),
      key(wipe, "transform.x", 2.5, 0),
      { command: "set_motion_blur", args: { clip_ids: [wipe], on: true } },
      { command: "set_track_matte", args: { clip_id: shot, matte_clip_id: wipe, mode: "alpha" } },
      { command: "set_wiggle", args: { clip_ids: [shot], target: "position", frequency: 3, amplitude: 14 } },
      { command: "set_wiggle", args: { clip_ids: [shot], target: "rotation", frequency: 2, amplitude: 0.6 } },
      { command: "set_edge_mode", args: { clip_ids: [shot], edge: "mirror" } },
      { command: "set_motion_blur", args: { clip_ids: [shot], on: true } },
    ],
  });

  // ---- lower third ----
  const barTrack = await track("Bar");
  const bar = clipOf(await call("add_shape", { kind: "rounded_rectangle", start: 2.7, duration: 3.3, x: -0.22, y: 0.3, width: 0.36, height: 0.12, radius: 0.3, color: "#0f1218", opacity: 0.92, track_id: barTrack }));
  await call("batch", {
    commands: [
      key(bar, "transform.x", 2.7, -1.0, "spring"),
      key(bar, "transform.x", 3.4, -0.22),
      { command: "set_motion_blur", args: { clip_ids: [bar], on: true } },
      { command: "set_animation", args: { clip_id: bar, slot: "out", type: "fade", duration: 0.3 } },
    ],
  });
  const accentTrack = await track("Accent");
  const accent = clipOf(await call("add_shape", { kind: "line", start: 3.1, duration: 2.9, x: -0.22, y: 0.228, width: 0.33, stroke_width: 6, gradient: { from: "#ffcc00", to: "#ff3d7f", angle: 0 }, track_id: accentTrack }));
  await call("batch", { commands: [key(accent, "shape.draw", 3.1, 0, "easeOut"), key(accent, "shape.draw", 3.5, 1)] });
  const nameTrack = await track("Name");
  const name = clipOf(await call("add_text", { text: "JORDAN LEE", start: 3.2, duration: 2.8, x: -0.22, y: 0.282, style: { size: 58, color: "#ffffff" }, track_id: nameTrack }));
  const roleTrack = await track("Role");
  const role = clipOf(await call("add_text", { text: "Creative Director", start: 3.35, duration: 2.65, x: -0.22, y: 0.333, style: { size: 34, bold: false, color: "#c8d0d8" }, track_id: roleTrack }));
  await call("batch", {
    commands: [name, role].flatMap((id) => [
      { command: "set_animation", args: { clip_id: id, slot: "in", type: "rise", duration: 0.4 } },
      { command: "set_animation", args: { clip_id: id, slot: "out", type: "fade", duration: 0.3 } },
    ]),
  });

  // ---- call to action ----
  const ctaTrack = await track("CTA");
  const cta = clipOf(await call("add_shape", { kind: "rounded_rectangle", start: 4, duration: 2, x: 0.3, y: 0.3, width: 0.18, height: 0.09, radius: 1, gradient: { from: "#ff3d7f", to: "#ff8a3d", angle: 0 }, track_id: ctaTrack }));
  await call("batch", { commands: [key(cta, "transform.scale", 4.0, 0, "elastic"), key(cta, "transform.scale", 4.6, 1), { command: "set_motion_blur", args: { clip_ids: [cta], on: true } }] });
  const ctaTextTrack = await track("CTA text");
  const ctaText = clipOf(await call("add_text", { text: "SHOP NOW", start: 4.15, duration: 1.85, x: 0.3, y: 0.3, style: { size: 40, color: "#ffffff" }, track_id: ctaTextTrack }));
  await call("set_animation", { clip_id: ctaText, slot: "in", type: "pop", duration: 0.45 });
  const calloutTrack = await track("Callout");
  const callout = clipOf(await call("add_shape", { kind: "ellipse", start: 4.7, duration: 1.3, x: 0.3, y: 0.3, width: 0.25, height: 0.17, fill: false, stroke_color: "#ffffff", stroke_width: 5, draw: 0, track_id: calloutTrack }));
  await call("batch", { commands: [key(callout, "shape.draw", 4.7, 0, "easeInOut"), key(callout, "shape.draw", 5.3, 1)] });

  // ---- check the description, then look ----
  const d = await call("describe_project");
  const all = d.tracks.flatMap((t) => t.clips);
  const byId = (id) => all.find((c) => c.id === id);
  const details = {};
  // 13 clips; the role's 3.35 + 2.65 s rounds to a frame past 6 s.
  details.built = { ok: d.duration >= 6 && d.duration < 6.05 && all.length === 13, duration: d.duration, clips: all.length, calls: calls.length };
  details.described = {
    ok:
      byId(inside).track_matte?.matte === word &&
      byId(shot).track_matte?.matte === wipe &&
      byId(bar).shape?.kind === "rounded_rectangle" &&
      byId(callout).shape?.fill === false &&
      byId(shot).edge === "mirror" &&
      !!byId(shot).wiggle?.x &&
      byId(wipe).motion_blur?.shutter_angle === 180,
    ground: !!byId(ground),
  };
  const times = [0.2, 0.7, 1.5, 2.1, 2.3, 2.6, 2.85, 3.3, 4.15, 4.4, 5.0, 5.7];
  const sheet = await call("preview_frames", { times, columns: 4, tile_width: 480 });
  const file = "__REPO__/scratch/graphics-sheet.png";
  fs.writeFileSync(file, Buffer.from(sheet.data, "base64"));
  // Two close-ups: the wipe's blurred edge, and the finished lower third.
  for (const at of [2.3, 5.7]) fs.writeFileSync(`__REPO__/scratch/graphics-${at}.png`, Buffer.from((await call("preview_frame", { at, max_width: 1280 })).data, "base64"));
  // A few pixel checks on the sheet itself (tiles 480 wide, each over an 18 px label strip, 6 px gaps).
  const px = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d");
    c.drawImage(bmp, 0, 0);
    const tile = (i, fx, fy) => {
      const w = 480, h = 270, x = 6 + (i % 4) * (w + 6), y = 6 + Math.floor(i / 4) * (h + 18 + 6);
      return [...c.getImageData(Math.floor(x + fx * w), Math.floor(y + fy * h), 1, 1).data].slice(0, 3);
    };
    return {
      size: [bmp.width, bmp.height],
      // 0.7 s: footage inside the B's stem, dark ground in the corner.
      letter: tile(1, 0.27, 0.45),
      corner: tile(1, 0.04, 0.9),
      // 5.0 s: the CTA pill's middle is pink-orange.
      cta: tile(10, 0.8, 0.8),
      // 3.3 s: the lower third's bar is dark, the shot around it is not.
      barMid: tile(7, 0.28 - 0.08, 0.8),
    };
  }, sheet.data);
  const dark = (c) => c.every((v) => v < 40);
  details.sheet = {
    ok: px.size[0] === 4 * 486 + 6 && !dark(px.letter) && dark(px.corner) && px.cta[0] > 180 && px.cta[2] < 160,
    file,
    ...px,
  };
  return { ok: Object.values(details).every((x) => x.ok), details };
};
