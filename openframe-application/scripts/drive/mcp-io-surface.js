// What the Codex film test found at the edge of the MCP surface (ADR-095),
// checked as an agent meets it, through window.videoEditor.mcp:
// - the server's instructions are a few lines and help holds the guide;
// - import_media knows a file by the file: a display name without an
//   extension, a URL without one (sniffed), a GIF without one (animated),
//   a .cube (a LUT), and a text file (refused, with its reason);
// - a renamed animation still moves after a reload;
// - folder is refused in the browser build, with the reason;
// - an unknown argument names the one meant; preview_frames takes 8 columns;
// - a title's type and a custom speed curve show in the answers;
// - an edit beside compound clips answers without their timelines.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  // URLs with no extension: the bytes of a fixture, or a text file.
  await page.route("**/no-ext/**", async (route) => {
    const u = new URL(route.request().url());
    const last = u.pathname.split("/").pop();
    if (last === "notes") return route.fulfill({ status: 200, contentType: "text/plain", body: "These are notes, not media." });
    const file = { clip: "person-pan.mp4", loop: "animated.gif" }[last];
    const res = await route.fetch({ url: `${u.origin}/fixtures/media/${file}` });
    return route.fulfill({ response: res, headers: { ...res.headers(), "content-type": "application/octet-stream" } });
  });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const rpc = (method, params = {}) => page.evaluate(([method, params]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method, params }), [method, params]);
  const raw = (name, args = {}) => rpc("tools/call", { name, arguments: args });
  const call = async (name, args = {}) => {
    const r = await raw(name, args);
    if (r.error) throw new Error(`${name}: ${r.error.message}`);
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    return r.result.content;
  };
  const text = async (name, args) => JSON.parse((await call(name, args))[0].text);
  const refusal = async (name, args) => {
    const r = await raw(name, args);
    return r.error ? r.error.message : r.result?.isError ? r.result.content[0].text : null;
  };
  const origin = await page.evaluate(() => location.origin);
  const details = {};

  // ---- the guide is read once ----
  const init = (await rpc("initialize")).result;
  const tools = (await rpc("tools/list")).result.tools;
  const overview = (await call("help"))[0].text;
  details.guideOnce = {
    // The browser build adds its word on export to the instructions.
    ok: init.instructions.length < 800 && overview.includes("To make a video:") && !tools.some((t) => t.description.includes("To make a video:") || t.description.includes(init.instructions.slice(0, 80))),
    instructions: init.instructions.length,
    initializeBytes: JSON.stringify(init).length,
    toolsListBytes: JSON.stringify(tools).length,
    tools: tools.length,
  };

  // ---- import by the file, never the label ----
  const files = [
    { src: `${origin}/fixtures/media/person-pan.mp4`, name: "launch" },
    { src: `${origin}/no-ext/clip`, name: "pan" },
    { src: `${origin}/no-ext/loop`, name: "loop" },
    { src: `${origin}/fixtures/media/identity-33.cube`, name: "Identity" },
    { src: `${origin}/no-ext/notes`, name: "notes" },
    { src: `${origin}/fixtures/media/animated.gif`, name: "spinner" },
  ];
  const got = await text("import_media", { files });
  const [launch, pan, loop, lut, notes, spinner] = got;
  const assets = (await text("describe_project")).assets;
  details.importByFile = {
    ok:
      got.length === 6 &&
      launch.kind === "video" && launch.name === "launch" && launch.width > 0 &&
      pan.kind === "video" && pan.name === "pan" &&
      loop.kind === "image" && assets.find((a) => a.id === loop.id)?.animated === true &&
      lut.kind === "lut" && /^lut/.test(lut.lut_id) &&
      /isn't a video, audio or image file/.test(notes.error ?? "") && notes.src.endsWith("/no-ext/notes") &&
      spinner.kind === "image",
    got,
  };
  const allFailed = await refusal("import_media", { files: [{ src: `${origin}/no-ext/notes`, name: "notes" }] });
  details.allFailedIsAnError = { ok: /^Nothing was imported\. .*no-ext\/notes: isn't a video/.test(allFailed ?? ""), message: allFailed };

  // ---- a renamed animation still moves after a reload ----
  await text("rename_media", { asset_id: spinner.id, name: "Spinner" });
  await text("add_media_clip", { asset_id: spinner.id, start: 0, duration: 2 });
  await text("add_media_clip", { asset_id: loop.id, start: 2, duration: 2 });
  const projectId = (await text("list_projects")).find((p) => p.open).id;
  await text("new_project", { name: "io-surface scratch" }); // saves the first
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await text("open_project", { project: projectId });
  await page.locator(".timeline-panel").waitFor();
  const frame = async (at) => (await call("preview_frame", { at, max_width: 160 }))[0].data;
  // animated.gif changes picture through its loop: two moments differ.
  const moves = async (a, b) => (await frame(a)) !== (await frame(b));
  details.animationByFile = { ok: (await moves(0.05, 0.55)) && (await moves(2.05, 2.55)), renamed: "Spinner" };

  // ---- folder is desktop only, said rather than ignored ----
  const folderRefusals = await Promise.all([
    refusal("export_video", { name: "x", folder: "D:/Deliveries" }),
    refusal("export_versions", { ratios: ["9:16"], folder: "D:/Deliveries" }),
    refusal("collect_project", { folder: "D:/Deliveries" }),
  ]);
  details.folderDesktopOnly = { ok: folderRefusals.every((m) => /desktop only/.test(m ?? "")), folderRefusals };

  // ---- mistakes are named with their fix ----
  const seek = await refusal("seek", { time: 1 });
  const tool = await refusal("seek_to", { at: 1 });
  details.didYouMean = { ok: /did you mean at\?/.test(seek ?? "") && /did you mean seek\?/.test(tool ?? ""), seek, tool };
  const sheet = await call("preview_frames", { times: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 3.9], columns: 8, tile_width: 160 });
  details.eightColumns = { ok: sheet[0].type === "image" && sheet[0].data.length > 1000 };

  // ---- answers say what is set ----
  const title = (await text("add_text", { text: "Home", start: 0, duration: 2, style: { font: "Georgia", weight: 300, size: 72, maxWidth: 0.5, letterSpacing: 12, lineHeight: 0.95 } })).added_clips[0];
  const video = (await text("add_media_clip", { asset_id: launch.id, start: 4, duration: 3 })).added_clips.find((c) => c.type === "video");
  const ramped = (await text("set_speed_curve", { clip_id: video.id, points: [{ t: 0, speed: 2 }, { t: 0.5, speed: 0.5 }, { t: 1, speed: 2 }] })).changed_clips.find((c) => c.id === video.id);
  details.clipDetails = {
    ok: title.weight === 300 && title.style?.font === "Georgia" && title.style.maxWidth === 0.5 && title.style.letterSpacing === 12 && title.style.lineHeight === 0.95 && ramped.speed_curve === "custom" && JSON.stringify(ramped.speed_points) === "[[0,2],[0.5,0.5],[1,2]]",
    title,
    speed: [ramped.speed_curve, ramped.speed_points],
  };

  // ---- compound clips stay out of other edits' answers ----
  for (const at of [10, 13, 16]) {
    const pic = (await text("add_media_clip", { asset_id: launch.id, start: at, duration: 2 })).added_clips.find((c) => c.type === "video");
    const words = (await text("add_text", { text: `Window ${at}`, start: at, duration: 2 })).added_clips[0];
    await text("create_compound_clip", { clip_ids: [pic.id, words.id], name: `Window ${at}` });
  }
  const beside = (await call("add_text", { text: "Beside", start: 20, duration: 1 }))[0].text;
  const whole = (await call("describe_project"))[0].text;
  await text("new_project", { name: "io-surface scratch 2" }); // saves the film
  const reopened = await text("open_project", { project: projectId });
  details.compoundsQuiet = {
    ok: !beside.includes("compounds") && beside.length < 900 && whole.includes("\"compounds\"") && reopened.counts.compounds === 3 && reopened.tracks === undefined,
    answerBytes: beside.length,
    describeBytes: whole.length,
    openProjectBytes: JSON.stringify(reopened).length,
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
