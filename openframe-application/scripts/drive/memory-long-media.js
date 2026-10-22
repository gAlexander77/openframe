// Twenty-minute VOD, real local speech, repeated project navigation and
// delivery. Run on this lane's :1450 with run.mjs --base. Requires the
// speech-test.wav and framecode-30.mp4 fixtures, ffmpeg, and model downloads.
// Main-renderer JS heap must return within 64 MiB of the warmed baseline;
// known retained bytes after Home must be <= 8 MiB, with no model/cursor/jobs.
async (page) => {
  const fs = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const dir = "__REPO__/scratch/memory-long-media";
  fs.mkdirSync(dir, { recursive: true });
  // Stream to disk. Repeating the actual speech fixture gives Whisper
  // recognizable words; periodic gains supply known highlight candidates.
  execFileSync("ffmpeg", ["-v", "error", "-y", "-stream_loop", "-1", "-i", "__REPO__/fixtures/media/speech-test.wav", "-t", "1200", "-af", "volume='if(between(mod(t,300),120,123),1,0.3)':eval=frame", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", `${dir}/speech-20min.wav`], { timeout: 120000 });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-stream_loop", "-1", "-i", "__REPO__/fixtures/media/framecode-30.mp4", "-i", `${dir}/speech-20min.wav`, "-map", "0:v:0", "-map", "1:a:0", "-t", "1200", "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", `${dir}/vod-20min.mp4`], { timeout: 180000 });

  page.setDefaultTimeout(30000);
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor?.memory);
  const call = (name, args = {}) => page.evaluate(async ([name, args]) => {
    const rpc = async (tool, arguments_) => {
      const reply = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: arguments_ } });
      if (reply.error || reply.result?.isError) throw new Error(`${tool}: ${JSON.stringify(reply)}`);
      return reply.result;
    };
    const result = await rpc(name, args);
    const text = result.content.find(c => c.type === "text");
    const answer = text ? JSON.parse(text.text) : {};
    if (!answer.job_id) return answer;
    let job = answer;
    const deadline = Date.now() + 20 * 60_000;
    while (job.state === "running" && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500));
      job = JSON.parse((await rpc("job_status", { job_id: answer.job_id })).content[0].text);
    }
    if (job.state !== "done" || job.result_released) throw new Error(`${name}: ${JSON.stringify(job)}`);
    return job.result;
  }, [name, args]);
  const close = async () => {
    await page.locator(".menubar-button", { hasText: /^File$/ }).click();
    await page.getByRole("menuitem", { name: "Back to home", exact: true }).click();
    await page.locator(".create-card").waitFor();
  };
  // Warm the editor before measuring; never compare a lazy Home module
  // against an editor whose code has only just been downloaded by Vite.
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => window.videoEditor.rendered());
  await close();
  let cdp = null;
  try { cdp = await page.context().newCDPSession(page); await cdp.send("Performance.enable"); } catch { cdp = null; }
  const measure = async () => {
    if (cdp) { await cdp.send("HeapProfiler.collectGarbage"); await cdp.send("HeapProfiler.collectGarbage"); }
    const known = await page.evaluate(() => window.videoEditor.memory());
    const browserHeap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    const metrics = cdp ? await cdp.send("Performance.getMetrics") : null;
    return { known, heap_bytes: metrics?.metrics.find(m => m.name === "JSHeapUsedSize")?.value ?? browserHeap, heap_source: cdp ? "CDP Performance.getMetrics after GC" : "performance.memory (GC unavailable)" };
  };
  const before = await measure();
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const origin = await page.evaluate(() => location.origin);
  const assets = await call("import_media", { files: [{ src: `${origin}/scratch/memory-long-media/speech-20min.wav` }, { src: `${origin}/scratch/memory-long-media/vod-20min.mp4` }] });
  const vod = assets.find(a => a.kind === "video"), wav = assets.find(a => a.kind === "audio");
  if (!vod || !wav) throw new Error(`Long fixture import failed: ${JSON.stringify(assets)}`);
  await call("add_media_clip", { asset_id: vod.id, start: 0 });
  const master = await page.evaluate(() => window.videoEditor.project().id);
  const full = await page.evaluate(id => window.videoEditor.project().tracks.flatMap(t => t.clips).find(c => c.assetId === id)?.id, vod.id);
  const imported = await measure();
  const highlights = await call("find_highlights", { asset_id: vod.id, count: 2, times: [181, 781], min_length: 20, max_length: 30, transcribe: true, scenes: true, wait: 0 });
  const analyzed = await measure();
  await call("delete_clips", { clip_ids: [full] });
  await call("add_media_clip", { asset_id: vod.id, start: 0, in: 180, duration: 30 });
  await call("add_media_clip", { asset_id: vod.id, start: 30, in: 780, duration: 30 });
  const first = await page.evaluate(id => window.videoEditor.project().tracks.flatMap(t => t.clips).find(c => c.assetId === id)?.id, vod.id);
  const captions = await call("auto_captions", { words_per_caption: 3, look: "pop", wait: 0 });
  const transcript = await call("get_transcript", { clip_id: first });
  const created = await call("create_clips", { asset_id: vod.id, clips: [{ start: 180, end: 210, title: "First speech window" }, { start: 780, end: 810, title: "Second speech window" }], template: { layout: "full", captions: { words: 3, look: "pop" } }, wait: 0 });
  // Hear the mix through MCP; job history must release its audio block.
  await call("preview_audio", { start: 0, end: 2, format: "wav" });
  const delivery = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const exported = await ve.render({ start: 0, end: 1, format: "mp4", resolution: "480p" });
    let bytes;
    try { bytes = (await (await fetch(exported.url)).blob()).size; }
    finally { ve.releaseUrl(exported.url); }
    const still = await ve.still();
    try { await (await fetch(still.url)).arrayBuffer(); }
    finally { ve.releaseUrl(still.url); }
    return { bytes, frames: exported.frames, retained_urls: ve.memory().kinds.answer_blob_urls?.bytes ?? 0, export_buffers: ve.memory().kinds.export_buffers?.bytes ?? 0 };
  });
  const delivered = await measure();
  for (const project of created.projects) {
    await call("open_project", { project: project.id });
    await page.evaluate(() => window.videoEditor.rendered());
  }
  await call("open_project", { project: master });
  await close();
  await page.waitForFunction(() => {
    const kinds = window.videoEditor.memory().kinds;
    return ["thumbnail_jobs", "compound_jobs", "preview_jobs", "decoder_cursors", "active_media_inputs"].every(k => !kinds[k]?.count) && Object.entries(kinds).filter(([key]) => key.startsWith("model_")).every(([, value]) => value.count === 0);
  }, null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  const after = await measure();
  const snapshots = { before, imported, analyzed, delivered, after };
  const overBudget = Object.entries(snapshots).flatMap(([stage, snapshot]) => Object.entries(snapshot.known.kinds).filter(([, k]) => k.budget !== undefined && k.bytes > k.budget).map(([kind, k]) => ({ stage, kind, ...k })));
  const details = {
    workflow: { ok: highlights.highlights.length === 2 && highlights.highlights.every(h => typeof h.title === "string" && h.title.length > 0 && h.title.length <= 60) && captions.count > 0 && transcript.words.length > 0 && created.projects.length === 2 && created.projects.every(p => p.captions > 0), titles: highlights.highlights.map(h => h.title), captions: captions.count, projects: created.projects.map(p => ({ id: p.id, captions: p.captions })) },
    export: { ok: delivery.bytes > 1000 && delivery.frames > 0 && delivery.retained_urls === 0 && delivery.export_buffers === 0, ...delivery },
    budgets: { ok: overBudget.length === 0, overBudget },
    closed: { ok: after.known.total_known_bytes <= 8 * 2 ** 20 && (after.known.kinds.undo_documents?.count ?? 0) === 0 && (after.known.kinds.transcript_words?.count ?? 0) === 0, known_bytes: after.known.total_known_bytes, budget_bytes: 8 * 2 ** 20 },
    heap: { ok: before.heap_bytes !== null && after.heap_bytes !== null && after.heap_bytes <= before.heap_bytes + 64 * 2 ** 20, before_bytes: before.heap_bytes, after_bytes: after.heap_bytes, delta_bytes: after.heap_bytes - before.heap_bytes, allowance_bytes: 64 * 2 ** 20, source: after.heap_source },
    measurements: snapshots,
  };
  await cdp?.detach();
  return { ok: [details.workflow, details.export, details.budgets, details.closed, details.heap].every(d => d.ok), details };
}
