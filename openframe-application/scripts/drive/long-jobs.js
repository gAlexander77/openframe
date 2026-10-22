// A generated six-minute WAV, with real speech repeated from the small
// fixture so Whisper has words to recognize. Only its middle 30 s is heard.
async (page) => {
  page.setDefaultTimeout(180000);
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  return page.evaluate(async () => {
    const ve = window.videoEditor;
    let sequence = 0;
    const call = async (name, args = {}) => {
      const response = await ve.mcp({ jsonrpc: "2.0", id: ++sequence, method: "tools/call", params: { name, arguments: args } });
      if (response.error || response.result?.isError) throw new Error(`${name}: ${JSON.stringify(response)}`);
      return JSON.parse(response.result.content.at(-1).text);
    };
    const collect = async answer => {
      if (!answer.job_id) return answer;
      const deadline = Date.now() + 20 * 60_000;
      let status = answer;
      while (status.state === "running" && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 500));
        status = await call("job_status", { job_id: answer.job_id });
      }
      if (status.state !== "done") throw new Error(`Job did not finish: ${JSON.stringify(status)}`);
      return status.result;
    };
    const { encodeWav } = await import("/src/lib/wav.ts");
    const loaded = performance.getEntriesByType("resource").map(e => e.name);
    const { adoptAndImport } = await import(loaded.find(n => new URL(n).pathname === "/src/state/media.ts") ?? "/src/state/media.ts");
    const context = new AudioContext({ sampleRate: 16000 });
    let speech;
    try { speech = await context.decodeAudioData(await (await fetch("/fixtures/media/speech-test.wav")).arrayBuffer()); }
    finally { await context.close(); }
    const rate = speech.sampleRate, duration = 360, pcm = new Float32Array(rate * duration);
    const source = speech.getChannelData(0), period = source.length + Math.round(rate * 0.75);
    for (let i = 0; i < pcm.length; i++) pcm[i] = source[i % period] ?? 0;
    const [asset] = await adoptAndImport([new File([encodeWav([pcm], rate)], "long-jobs-speech.wav", { type: "audio/wav" })]);
    await call("add_media_clip", { asset_id: asset.id, start: 0, in: 180, duration: 30 });
    const track = ve.project().tracks.find(t => t.clips.some(c => c.assetId === asset.id));
    await call("update_track", { track_id: track.id, role: "dialog" });
    const clip = track.clips.find(c => c.assetId === asset.id);
    const started = performance.now();
    const running = await call("auto_captions", { wait: 0 });
    const returnedSeconds = (performance.now() - started) / 1000;
    const result = await collect(running);
    const details = {
      immediate: { ok: running.state === "running" && !!running.job_id && returnedSeconds < 5, running, returnedSeconds },
      window: { ok: result.audio_seconds >= 30 && result.audio_seconds <= 40 && result.count > 0 && result.words > 0 && result.model.includes("base.en"), result },
    };
    const reused = await collect(await call("get_transcript", { clip_id: clip.id }));
    details.reuse = { ok: reused.audio_seconds === 0 && reused.cached === true && reused.words.length > 0, result: reused };
    await call("add_media_clip", { asset_id: asset.id, start: 40, in: 60, duration: 30 });
    const second = ve.project().tracks.flatMap(t => t.clips).find(c => c.assetId === asset.id && c.in === 60);
    const canceling = await call("get_transcript", { clip_id: second.id, wait: 0 });
    const canceled = await call("cancel_job", { job_id: canceling.job_id });
    const status = await call("job_status", { job_id: canceling.job_id });
    details.cancel = { ok: canceling.state === "running" && canceled.state === "canceled" && status.state === "canceled" && status.result === undefined, canceling, canceled, status };
    const highlights = await collect(await call("find_highlights", { asset_id: asset.id, times: [190], count: 1, scenes: false, transcribe: false, wait: 0 }));
    details.highlights = { ok: highlights.asset_id === asset.id && highlights.highlights.length > 0, result: highlights };
    const all = await call("job_status");
    details.retained = { ok: all.some(j => j.job_id === running.job_id && j.state === "done" && j.result?.count === result.count), jobs: all.map(({ result, ...job }) => job) };
    return { ok: Object.values(details).every(d => d.ok), details };
  });
};
