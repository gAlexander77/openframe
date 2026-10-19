// What making the launch film through MCP asked of the tools (docs/research/
// Launch film through MCP 2026-10-18.md), over window.videoEditor.mcp
// JSON-RPC: keyframes refused on paths that do not animate, keys in the
// answers, a montage's sounds in one call and one undo step, check_project
// measuring contrast on the rendered picture (white over a dark ground with
// a dim picture in it passes, white over a bright photo is named with its
// ratio) and each music clip's end, an edit inside a compound answered with
// that compound alone, a unique copy of a window compound taking other
// footage, and an export_versions check sheet of a sliding window and a
// wide wordmark (saved to scratch/mcp-launch-film-versions.png for a look).
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const rpc = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const call = async (name, args = {}) => {
    const r = await rpc(name, args);
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    return r.result.content;
  };
  const text = async (name, args) => JSON.parse((await call(name, args))[0].text);
  const refused = async (name, args) => {
    const r = await rpc(name, args);
    return r.result?.isError ? r.result.content[0].text : null;
  };
  const origin = await page.evaluate(() => location.origin);
  const details = {};

  // ---- a project, answered in a few words ------------------------------------------
  const fresh = await text("new_project", { name: "Launch film check" });
  details.newProject = { ok: !!fresh.counts && !fresh.tracks && /describe_project/.test(fresh.note), fresh };

  // A sound that fades out in its own audio: 7 s of tone, the last 1.5 s
  // fading to nothing, written beside the drive's other scratch and served.
  const { writeFileSync } = await import("node:fs");
  {
    const rate = 22050, n = rate * 7, b = Buffer.alloc(44 + n * 2);
    b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) {
      const t = i / rate, g = t < 5.5 ? 0.5 : 0.5 * Math.max(0, (7 - t) / 1.5) ** 3;
      b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * t) * g * 32767), 44 + i * 2);
    }
    writeFileSync("__REPO__/scratch/fade-out.wav", b);
  }
  const fadeUrl = `${origin}/scratch/fade-out.wav`;
  const [ui, photo, music, fade] = await text("import_media", {
    files: [{ src: `${origin}/fixtures/media/h264-1080p30.mp4` }, { src: `${origin}/fixtures/media/photo.jpg` }, { src: `${origin}/fixtures/media/music-30s.mp3` }, { src: fadeUrl, name: "fade-out.wav" }],
  });
  const main = (await text("describe_project")).tracks.find((t) => t.main).id;

  // ---- the film's shape: dark ground, a dim picture as a glow, a sliding window ----
  const built = await text("batch", {
    commands: [
      { command: "add_color_clip", args: { color: "#05060a", start: 0, duration: 12, track_id: main } },
      { command: "add_media_clip", args: { asset_id: photo.id, start: 0, duration: 6 } },
      { command: "set_param", args: { clip_ids: ["$2"], path: "opacity", value: 0.06 } },
      { command: "set_blend", args: { clip_ids: ["$2"], mode: "screen" } },
      { command: "add_text", args: { text: "Pro editing.", start: 0.5, duration: 2.5, y: -0.05, style: { size: 150, bold: true } } },
      // The window: footage, a rounded mask and a hairline border, as one compound clip.
      { command: "add_media_clip", args: { asset_id: ui.id, start: 3, duration: 3, in: 2 } },
      { command: "set_param", args: { clip_ids: ["$6"], path: "transform.scale", value: 0.8 } },
      { command: "set_mask", args: { clip_ids: ["$6"], shape: "rectangle", width: 1, height: 1, radius: 0.04 } },
      { command: "add_shape", args: { kind: "rounded_rectangle", start: 3, duration: 3, width: 0.8, height: 0.8, radius: 0.04, fill: false, stroke_color: "#ffffff66", stroke_width: 3 } },
      { command: "create_compound_clip", args: { clip_ids: ["$6", "$9"], name: "Window: cut" } },
      { command: "add_text", args: { text: "Cut.", start: 3, duration: 3, x: -0.346, y: -0.04, style: { size: 165, bold: true } } },
    ],
  });
  const all = async () => (await text("describe_project")).tracks.flatMap((t) => t.clips);
  const win = (await all()).find((c) => c.type === "compound");
  const compoundId = win.compound;
  // A bright photo with a white title on it, the shots on one track above
  // the background as the film keeps them; then the wordmark.
  const winTrack = (await text("describe_project")).tracks.find((t) => t.clips.some((c) => c.id === win.id)).id;
  await text("batch", {
    commands: [
      { command: "add_media_clip", args: { asset_id: photo.id, start: 6, duration: 3, track_id: winTrack } },
      { command: "add_text", args: { text: "Sunny", start: 6.5, duration: 2, y: -0.36, style: { size: 150, bold: true } } },
      { command: "add_text", args: { text: "OpenFrame", start: 9, duration: 3, y: 0.06, style: { size: 170, bold: true, letterSpacing: -5 } } },
    ],
  });
  details.built = { ok: built.added_compounds?.length === 1 && !built.compounds, compounds: built.added_compounds };

  // ---- keyframes: refused where nothing moves, shown where they are --------------------
  const title = (await all()).find((c) => c.text === "Pro editing.");
  const dead = await refused("add_keyframe", { clip_id: title.id, path: "style.lineHeight", at: 1, value: 2 });
  const deadAudio = await refused("add_keyframe", { clip_id: (await text("add_media_clip", { asset_id: music.id, start: 0, duration: 12 })).added_clips[0].id, path: "transform.x", at: 1, value: 0.2 });
  details.keyframeRefused = { ok: /does not animate on text clips.*Animatable on this clip: transform.x/.test(dead ?? "") && /style.size/.test(dead ?? "") && /audio clips/.test(deadAudio ?? ""), dead, deadAudio };
  const slide = await text("batch", {
    commands: [
      { command: "add_keyframe", args: { clip_id: win.id, path: "transform.x", at: 3, value: 0.75, ease: "fastIn" } },
      { command: "add_keyframe", args: { clip_id: win.id, path: "transform.x", at: 3.5, value: 0.16 } },
      { command: "add_keyframe", args: { clip_id: win.id, path: "transform.scale", at: 3, value: 0.7, bezier: [0.2, 0, 0, 1] } },
      { command: "add_keyframe", args: { clip_id: win.id, path: "transform.scale", at: 5.96, value: 0.74 } },
      { command: "set_motion_blur", args: { clip_ids: [win.id], on: true } },
    ],
  });
  const keys = slide.changed_clips?.[0]?.keyframes;
  const moved = await text("set_param", { clip_ids: [win.id], path: "transform.x", value: 0.2, at: 3.5 });
  details.keysInAnswers = {
    ok: JSON.stringify(keys?.["transform.x"]) === JSON.stringify([[3, 0.75, "fastIn"], [3.5, 0.16]]) && JSON.stringify(keys?.["transform.scale"]?.[0]) === JSON.stringify([3, 0.7, [0.2, 0, 0, 1]]) && moved.changed_clips?.[0]?.keyframes?.["transform.x"]?.[1]?.[1] === 0.2,
    keys,
    moved: moved.changed_clips?.[0]?.keyframes,
  };
  await text("set_param", { clip_ids: [win.id], path: "transform.x", value: 0.16, at: 3.5 });

  // ---- an edit inside a compound answers with that compound alone ---------------------
  const inner = await text("edit_compound", { compound_id: compoundId, command: "set_param", args: { clip_ids: [(await text("describe_project")).compounds[0].tracks.flatMap((t) => t.clips).find((c) => c.type === "video").id], path: "opacity", value: 0.95 } });
  details.compoundAnswer = { ok: inner.changed_compounds?.length === 1 && inner.changed_compounds[0].clips === 2 && inner.changed_compounds[0].changed_clips?.length === 1 && !inner.compounds && !inner.changed_compounds[0].tracks, inner };

  // ---- a montage's sounds in one call and one undo step --------------------------------
  const sounds = await text("add_sound_effect", { sounds: [{ name: "whoosh", end_at: 3.1 }, { name: "whoosh", start: 5.9, volume: 0.6 }, { name: "rise", end_at: 9 }, { name: "impact", start: 9 }] });
  const undone = await text("undo");
  const redone = await text("redo");
  details.sounds = { ok: sounds.clip_ids?.length === 4 && sounds.added_clips?.length === 4 && undone.removed_clips?.length === 4 && redone.added_clips?.length === 4, clipIds: sounds.clip_ids, undone: undone.removed_clips };

  // ---- check_project measures instead of guessing --------------------------------------
  const check = await text("check_project", {});
  const find = (rule, id) => check.findings.find((f) => f.rule === rule && (!id || f.clip_id === id));
  const sunny = (await all()).find((c) => c.text === "Sunny");
  const musicClip = (await all()).find((c) => c.asset === music.id);
  details.contrast = {
    ok: !find("text_contrast_risk") && !find("text_low_contrast", title.id) && !!find("text_low_contrast", sunny.id) && / measures [\d.]+:1 against the picture/.test(find("text_low_contrast", sunny.id)?.message ?? ""),
    sunny: find("text_low_contrast", sunny.id)?.message,
    rules: check.findings.map((f) => f.rule),
  };
  details.musicEnd = { ok: /dBFS/.test(find("music_ends_abruptly", musicClip.id)?.message ?? ""), message: find("music_ends_abruptly", musicClip.id)?.message };
  // The same music faded with set_fades, and a track that fades in its own audio: no finding.
  await text("set_fades", { clip_ids: [musicClip.id], fade_out: 1.5 });
  const fadeClip = (await text("add_media_clip", { asset_id: fade.id, start: 5, duration: 7 })).added_clips[0];
  const check2 = await text("check_project", {});
  details.musicFadesByItself = { ok: !check2.findings.some((f) => f.rule === "music_ends_abruptly"), fadeClip: fadeClip.id, rules: check2.findings.map((f) => f.rule), summary: check2.summary };
  details.shots = { ok: check2.summary.shots >= 2, summary: check2.summary };

  // ---- a window compound as a template ---------------------------------------------------
  const copy = await text("duplicate_clips", { clip_ids: [win.id], at: 12, unique: true });
  const copyCompound = copy.added_compounds?.[0]?.id;
  const copyVideo = (await text("describe_project")).compounds.find((k) => k.id === copyCompound).tracks.flatMap((t) => t.clips).find((c) => c.type === "video");
  const swapped = await text("edit_compound", { compound_id: copyCompound, command: "replace_clip", args: { clip_id: copyVideo.id, asset_id: photo.id } });
  const d = await text("describe_project");
  const assetIn = (id) => d.compounds.find((k) => k.id === id).tracks.flatMap((t) => t.clips).find((c) => c.type === "video" || c.type === "image")?.asset;
  details.uniqueCopy = { ok: !!copyCompound && copyCompound !== compoundId && assetIn(compoundId) === ui.id && assetIn(copyCompound) === photo.id && swapped.changed_compounds?.[0]?.id === copyCompound, copy: copy.added_compounds, swapped: swapped.changed_compounds };
  await text("delete_clips", { clip_ids: [copy.added_clips[0].id] });

  // ---- export_versions of the keyframed layout: a sheet to look at ------------------------
  const duration = (await text("describe_project")).duration;
  const at = [3.05, 3.3, 4.5, 10.5].map((s) => +(s / duration).toFixed(4));
  const sheet = await call("export_versions", { ratios: ["16:9", "9:16", "1:1"], check: true, check_at: at });
  writeFileSync("__REPO__/scratch/mcp-launch-film-versions.png", Buffer.from(sheet[0].data, "base64"));
  details.versionsSheet = { ok: sheet[0].type === "image" && /of its length/.test(sheet[1].text), note: JSON.parse(sheet[1].text).note };
  const frames = await call("preview_frames", { times: [3.05, 3.3, 4.5, 7, 10.5], tile_width: 480, columns: 5 });
  writeFileSync("__REPO__/scratch/mcp-launch-film-master.png", Buffer.from(frames[0].data, "base64"));

  return { ok: Object.values(details).every((x) => x.ok), details };
};
