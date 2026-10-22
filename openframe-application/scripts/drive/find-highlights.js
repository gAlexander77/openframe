// Ten-minute synthetic VOD: known speech-like bursts plus matching chat.
// Measures the real uncached browser decode, then checks the cached marker
// edit, one-step undo, following markers and the shared results card.
async (page) => {
  page.setDefaultTimeout(20000);
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result?.isError) throw new Error(JSON.stringify(r));
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
    };
    const loaded = performance.getEntriesByType("resource").map(e => e.name);
    const { adoptAndImport } = await import(loaded.find(n => new URL(n).pathname === "/src/state/media.ts") ?? "/src/state/media.ts");
    const { encodeWav } = await import("/src/lib/wav.ts");
    const rate = 16000, duration = 600, centers = [121.5, 301.5, 481.5];
    const pcm = new Float32Array(rate * duration);
    let seed = 42, filtered = 0;
    for (let i = 0; i < pcm.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      filtered = 0.6 * filtered + 0.4 * (seed / 4294967296 * 2 - 1);
      const t = i / rate, gain = centers.some(c => Math.abs(t - c) < 1.5) ? Math.sqrt(10) : 1;
      pcm[i] = filtered * 0.04 * gain * (0.7 + 0.3 * Math.sin(2 * Math.PI * 6 * t));
    }
    const [asset] = await adoptAndImport([new File([encodeWav([pcm], rate)], "highlight-vod.wav", { type: "audio/wav" })]);
    if (!asset) throw new Error("Synthetic VOD import failed");
    ve.exec("add_media_clip", { asset_id: asset.id, start: 5 });
    const clip = ve.project().tracks.flatMap(t => t.clips).find(c => c.assetId === asset.id);
    ve.select([clip.id]);
    const comments = [];
    // A small normal audience, then 40 messages/sec around each burst.
    for (let t = 0; t < duration; t += 4) comments.push({ content_offset_seconds: t, message: { body: "hello" } });
    for (const c of centers) for (let j = 0; j < 120; j++) comments.push({ content_offset_seconds: c - 1.5 + j / 40, message: { body: "KEKW clip that W" } });
    const chat = URL.createObjectURL(new Blob([JSON.stringify({ comments })], { type: "application/json" }));
    try {
      const before = ve.project().markers.length;
      const started = performance.now();
      const answer = await call("find_highlights", { asset_id: asset.id, count: 3, min_length: 20, max_length: 60, scenes: false, chat_file: chat });
      const ms = performance.now() - started;
      const peaks = answer.highlights.map(h => h.peak).sort((a, b) => a - b);
      const ranking = { ok: peaks.length === 3 && peaks.every((t, i) => Math.abs(t - centers[i]) <= 1.5) && answer.highlights.every(h => h.reasons.some(r => r.includes("chat"))), peaks, centers, highlights: answer.highlights };
      const speed = { ok: ms < 10000 && answer.elapsed_seconds < 10 && !answer.cached, ms, elapsed: answer.elapsed_seconds };
      const readOnly = { ok: ve.project().markers.length === before, before, after: ve.project().markers.length };
      const marked = await call("find_highlights", { clip_id: clip.id, count: 3, min_length: 20, max_length: 60, scenes: false, chat_file: chat, markers: true });
      const markers = ve.project().markers.filter(m => m.follows?.clip === clip.id && /^Highlight \d+$/.test(m.label));
      const fps = ve.project().fps.num / ve.project().fps.den;
      const markerCheck = { ok: marked.cached && markers.length === 3 && marked.highlights.every((h, i) => markers.some(m => m.label === `Highlight ${i + 1}` && Math.abs(m.frame / fps - (h.start + 5)) < 0.04 && Math.abs(m.duration / fps - (h.end - h.start)) < 0.04)), markers };
      ve.action("undo");
      const undo = { ok: ve.project().markers.length === before, markers: ve.project().markers.length };
      ve.action("redo");
      const duplicate = await call("find_highlights", { clip_id: clip.id, count: 3, min_length: 20, max_length: 60, scenes: false, chat_file: chat, markers: true });
      const repeat = { ok: duplicate.cached && ve.project().markers.length === before + 3 };
      const positions = ve.project().markers.map(m => m.frame);
      ve.exec("move_clip", { clip_id: clip.id, start: 10 });
      const following = { ok: ve.project().markers.every((m, i) => m.frame === positions[i] + 5 * fps) };
      ve.action("undo");
      return { ranking, speed, readOnly, markers: markerCheck, undo, repeat, following };
    } finally { URL.revokeObjectURL(chat); }
  });
  // Open the actual card after an MCP reading: both surfaces share it.
  await page.getByRole("tab", { name: "AI tools", exact: true }).click();
  const card = page.locator(".ai-highlights");
  await card.waitFor();
  details.ui = { ok: await card.locator(".highlight-results li").count() === 3 && await card.getByRole("button", { name: "Add markers", exact: true }).isEnabled() };
  const target = await page.evaluate(() => document.querySelector(".highlight-pick")?.getAttribute("aria-label"));
  await card.getByRole("button", { name: target, exact: true }).click();
  const seconds = await page.evaluate(() => { const ve = window.videoEditor; return ve.state().playhead * ve.project().fps.den / ve.project().fps.num; });
  details.seek = { ok: Math.abs(seconds - (details.ranking.highlights[0].start + 5)) < 0.04, seconds };
  // Review Add markers uses the named edit and never runs the detector again.
  await card.getByRole("button", { name: "Add markers", exact: true }).click();
  details.uiMarkers = { ok: await page.evaluate(() => window.videoEditor.project().markers.filter(m => /^Highlight \d+$/.test(m.label)).length === 3) };
  for (const size of [{ width: 1100, height: 680 }, { width: 1600, height: 950 }]) {
    await page.setViewportSize(size);
    const fits = await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && Array.from(el.querySelectorAll("button,input,select")).every(x => x.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1));
    details[`layout${size.width}`] = { ok: fits };
  }
  return { ok: Object.values(details).every(d => d.ok), details };
}
