// A two-minute VOD fixture with repeating real speech. Creates three
// edited projects, checks saved documents and batch exports real files.
// Needs speech-test.wav, ffmpeg and ffprobe on PATH; ASR may download once.
async (page) => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const outDir = "__REPO__/scratch/create-clips";
  fs.mkdirSync(outDir, { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-stream_loop", "-1", "-i", "__REPO__/fixtures/media/speech-test.wav", "-f", "lavfi", "-i", "color=c=blue:s=640x360:r=30:d=120", "-map", "1:v:0", "-map", "0:a:0", "-vf", "drawbox=x=0:y=0:w=160:h=126:color=red:t=fill", "-t", "120", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", `${outDir}/vod.mp4`], { timeout: 120000 });
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  const call = (name, args = {}) => page.evaluate(async ([name, args]) => {
    const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    if (r.result?.isError || r.error) throw new Error(`${name}: ${JSON.stringify(r)}`);
    const answer = JSON.parse(r.result.content[0].text);
    if (!answer.job_id) return answer;
    let job = answer;
    const deadline = Date.now() + 20 * 60_000;
    while (job.state === "running" && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const poll = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "job_status", arguments: { job_id: answer.job_id } } });
      if (poll.error || poll.result?.isError) throw new Error(JSON.stringify(poll));
      job = JSON.parse(poll.result.content[0].text);
    }
    if (job.state !== "done") throw new Error(`${name}: ${JSON.stringify(job)}`);
    return job.result;
  }, [name, args]);
  const origin = await page.evaluate(() => location.origin);
  const [a] = await call("import_media", { files: [{ src: `${origin}/scratch/create-clips/vod.mp4`, name: "Speech VOD.mp4" }] });
  await call("add_media_clip", { asset_id: a.id, start: 0 });
  const before = await page.evaluate(() => ({ id: window.videoEditor.project().id, json: JSON.stringify(window.videoEditor.project()), undo: window.videoEditor.state().undoLabel }));
  const moments = [{ start: 0, end: 20, title: "First play" }, { start: 40, end: 65, title: "The clutch", name: "Clutch" }, { start: 80, end: 110, title: "Great finish" }];
  const result = await call("create_clips", { asset_id: a.id, clips: moments, template: { layout: "stream", facecam: { x: 0, y: 0, w: 0.25, h: 0.35 }, gameplay: { x: 0.25, y: 0, w: 0.75, h: 1 }, captions: { words: 2, look: "pop" }, credit: { name: "Fixture streamer", handle: "@fixture", platform: "twitch" } } });
  const details = {};
  const after = await page.evaluate(() => ({ json: JSON.stringify(window.videoEditor.project()), undo: window.videoEditor.state().undoLabel }));
  details.original = { ok: after.json === before.json && after.undo === before.undo };
  const all = await call("list_projects");
  const saved = Array.isArray(all) ? all : all.projects;
  details.created = { ok: result.projects.length === 3 && result.projects.every((p, i) => saved.some(s => s.id === p.id) && p.seconds >= [22, 27, 32][i] && p.seconds <= [24, 29, 34][i] && p.captions > 0), projects: result.projects };
  for (const [i, made] of result.projects.entries()) {
    await call("open_project", { project: made.id });
    const q = await page.evaluate(() => window.videoEditor.project());
    const clips = q.tracks.flatMap(t => t.clips), text = clips.filter(c => c.type === "text");
    details[`project${i + 1}`] = { ok: q.assets[0].src === JSON.parse(before.json).assets[0].src && clips.filter(c => c.type === "video" && !c.muted).length === 1 && text.some(c => c.caption && c.wordTimes?.length && c.style.highlight) && text.some(c => c.text === moments[i].title && c.duration === 75) && text.some(c => c.text.includes("@fixture") && c.duration === 90) && text.some(c => c.text === "Follow Fixture streamer on twitch") };
  }
  await call("open_project", { project: before.id });
  await page.evaluate(() => {
    window.__clipFiles = {};
    window.showSaveFilePicker = async o => ({
      name: o.suggestedName,
      createWritable: async () => {
        let buf = new Uint8Array(1 << 20), size = 0;
        return {
          write: async c => {
            const end = c.position + c.data.byteLength;
            if (end > buf.length) { const next = new Uint8Array(Math.max(end, buf.length * 2)); next.set(buf.subarray(0, size)); buf = next; }
            buf.set(c.data, c.position); size = Math.max(size, end);
          },
          close: async () => { let s = ""; for (let i = 0; i < size; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, Math.min(size, i + 0x8000))); window.__clipFiles[o.suggestedName] = btoa(s); },
          abort: async () => {},
        };
      },
    });
  });
  let exported = await call("export_projects", { resolution: "480p", loudness: -14 });
  while (exported.state === "running") { await page.waitForTimeout(1000); exported = await call("export_status"); }
  const files = await page.evaluate(() => window.__clipFiles);
  const reports = [];
  for (const file of exported.projects ?? []) {
    const out = path.join(outDir, path.basename(file.path));
    if (!files[file.path]) { reports.push({ ok: false, path: file.path, missing: true }); continue; }
    fs.writeFileSync(out, Buffer.from(files[file.path], "base64"));
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", out]).toString());
    const { spawnSync } = await import("node:child_process");
    const meter = spawnSync("ffmpeg", ["-hide_banner", "-i", out, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 24 });
    const lufs = Number([...meter.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1]);
    const actual = Number(probe.format.duration);
    reports.push({ ok: meter.status === 0 && Math.abs(actual - file.seconds) < 0.15 && file.loudness && Math.abs(lufs + 14) < 1.2 && Math.abs(lufs - file.loudness.integrated) < 1.2 && Array.isArray(file.findings), path: file.path, seconds: actual, lufs, reported: file.loudness, findings: file.findings });
  }
  details.exports = { ok: exported.state === "done" && reports.length === 3 && reports.every(r => r.ok), files: reports };
  details.restored = { ok: await page.evaluate(json => JSON.stringify(window.videoEditor.project()) === json, before.json) };
  // Human fallback: a range marker and the same shared creation function.
  await call("add_marker", { at: 5, duration: 20, label: "Highlight 1" });
  await page.getByRole("tab", { name: "Media", exact: true }).click();
  await page.locator(".media-card").first().click({ button: "right" });
  await page.getByText("Make clips from markers", { exact: true }).click();
  details.markerDialog = { ok: await page.getByRole("button", { name: "Make 1 clips", exact: true }).isVisible() };
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".menubar-button", { hasText: /^File$/ }).click();
  await page.getByRole("menuitem", { name: "Back to home", exact: true }).click();
  await page.locator(".create-card").waitFor();
  for (const made of result.projects) await page.getByRole("checkbox", { name: `Select ${made.name} for export`, exact: true }).check();
  await page.getByRole("button", { name: "Export selected (3)", exact: true }).click();
  details.homeExportDialog = { ok: await page.getByRole("dialog", { name: "Export selected projects", exact: true }).isVisible() };
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  return { ok: Object.values(details).every(d => d.ok), details };
}
