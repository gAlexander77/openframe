// Film 5: cropped canvas fill in the actual compositor, covering cutaways,
// portrait subject/title diagnostics and the ninth check-time refusal.
async (page) => {
  let timer;
  let rejectPageError;
  const pageError = new Promise((_, reject) => { rejectPageError = reject; });
  const onPageError = (error) => rejectPageError(new Error(`film5-layout pageerror: ${error.stack || error.message}`));
  page.on("pageerror", onPageError);
  try {
    return await Promise.race([
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("film5-layout timed out after 60 seconds")), 60000); }),
      pageError,
      run(),
    ]);
  } finally {
    clearTimeout(timer);
    page.off("pageerror", onPageError);
  }

  async function run() {
    await page.goto("http://localhost:1420");
    await page.waitForFunction(() => !!window.videoEditor);
    await page.locator(".create-card").click();
    await page.locator(".timeline-panel").waitFor();
    const details = await page.evaluate(async () => {
      const ve = window.videoEditor;
      const details = {};
      const { versionProject, boxOf } = await import("/src/lib/versions.ts");
      const { textLines } = await import("/src/lib/render/size.ts");
      const { createProject } = await import("/src/lib/project/defaults.ts");
      const { runCommand } = await import("/src/lib/commands.ts");
      const [pic] = await ve.import([{ src: location.origin + "/fixtures/media/color-bars.png" }]);
      if (!pic.id) throw Error(JSON.stringify(pic));
      ve.exec("set_project", { width: 1080, height: 1920 });
      // No backdrop clip: color clips land on an overlay above the picture and
      // would cover the corners whatever the fill does. Uncovered corners show
      // the black project background unless the canvas fill paints them.
      ve.exec("add_media_clip", { asset_id: pic.id, start: 0, duration: 4 });
      const c = ve.project().tracks.flatMap(t => t.clips).find(c => c.type === "image");
      ve.exec("set_crop", { clip_ids: [c.id], left: 0.09, right: 0.54, top: 0.04, bottom: 0.59 });
      ve.exec("set_param", { clip_ids: [c.id], path: "transform.scale", value: 2.5 });
      ve.exec("set_canvas_fill", { clip_ids: [c.id], fill: "color", color: "#071322" });
      ve.seek(1);
      await ve.rendered();
      const px = ve.pixels();
      const corners = [[0.01, 0.01], [0.99, 0.01], [0.01, 0.99], [0.99, 0.99]].map(([x, y]) => {
        const i = (Math.floor(y * px.height) * px.width + Math.floor(x * px.width)) * 4;
        return Array.from(px.data.slice(i, i + 3));
      });
      details.canvas = { ok: corners.every(rgb => rgb.every((v, i) => Math.abs(v - [7, 19, 34][i]) <= 3)), corners };

      // Exact reported launch dimensions, independently of fixture encoding.
      let p = createProject({ width: 1920, height: 1080, fps: { num: 30, den: 1 } });
      p.assets.push({ id: "launch", name: "Launch", src: "launch.mp4", kind: "video", duration: 60, width: 1920, height: 1012, hasAudio: true, hasVideo: true });
      const report = {};
      runCommand(p, "add_media_clip", { asset_id: "launch", start: 16.1, duration: 5.7, in: 12 }, report);
      p = runCommand(p, "add_media_clip", { asset_id: "launch", start: 0, duration: 10, fit: "fill" });
      const shot = p.tracks[0].clips[0];
      details.cutaway = { ok: Math.abs(shot.transform.scale - 1080 / 1012) < 1e-6 && /transparent bands/.test(report.notes.join(" ")), report };
      p = runCommand(p, "add_text", { text: "Jeanette Epps\nNASA astronaut", start: 1, duration: 4.8, x: -0.22, y: 0.17, style: { size: 50, maxWidth: 0.48 } });
      p = runCommand(p, "add_captions", { captions: [{ start: 3, end: 7.2, text: "Being the first anything to me\nbears a lot of responsibility." }], style: { size: 52, maxWidth: 0.84 } });
      const title = p.tracks.flatMap(t => t.clips).find(c => c.type === "text" && !c.caption).id;
      const v = new Float32Array(100 * 60);
      for (let y = 15; y < 40; y++) for (let x = 60; x < 76; x++) v[y * 100 + x] = 1;
      const looks = { [shot.id]: { assetId: "launch", times: [0], maps: [{ w: 100, h: 60, v }] } };
      const says = { options: [], coverage: [] };
      const q = versionProject(p, { ratio: "9:16", focus: [{ clip_id: shot.id, x: 0.68, y: 0.5 }] }, undefined, looks, [], [], [], says);
      const b = boxOf(q, q.tracks.flatMap(t => t.clips).find(c => c.id === title));
      const caps = q.tracks.flatMap(t => t.clips).filter(c => c.caption);
      details.portrait = { ok: (b.bottom <= q.height * 0.32 || b.top >= q.height * 0.68) && caps.length > 1 && caps.every(c => textLines(q, c).length <= 2) && says.options.some(x => x.clip_id === title && /subject/.test(x.note)), box: b, captions: caps.map(c => ({ text: c.text, lines: textLines(q, c) })), options: says.options };
      const auto = { options: [], coverage: [] };
      versionProject(p, { ratio: "9:16" }, undefined, looks, [], [], [], auto);
      details.confidence = { ok: auto.options.some(x => /low-confidence/.test(x.note)), options: auto.options };
      const refused = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "export_versions", arguments: { ratios: ["9:16"], check: true, check_times: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 1, 2, 3] } } });
      details.ninthTime = { ok: refused.result.isError === true && /at most 8/.test(refused.result.content[0].text), result: refused.result };
      return details;
    });
    return { ok: Object.values(details).every(x => x.ok), details };
  }
}
