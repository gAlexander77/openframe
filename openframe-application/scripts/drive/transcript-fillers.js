// Stub only Whisper, keeping decode, transcript cache, MCP and edits real.
// A window-only hearing loses the um; both tools must use the whole source.
async (page) => {
  let hearings = 0;
  await page.route("**/__heard", (route) => { hearings++; return route.fulfill({ body: "ok" }); });
  await page.route("**/asr.worker.ts*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    self.onmessage = ({ data: m }) => {
      if (m.type === "load") return postMessage({ id: m.id, type: "ready" });
      fetch("/__heard");
      const words = [{ text: " So,", start: 1.1, end: 1.3 }, { text: " um,", start: 1.5, end: 1.7 }, { text: " we", start: 2, end: 2.2 }, { text: " go.", start: 2.4, end: 2.7 }];
      postMessage({ id: m.id, type: "words", words: m.offset ? words.filter(w => !w.text.includes("um")) : words });
    };` }));
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  const details = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.result.isError) throw new Error(r.result.content[0].text);
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
    const [a] = await ve.import([{ name: "speech-test.wav", src: location.origin + "/fixtures/media/speech-test.wav" }]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0, in: 1, duration: 2 });
    const c = ve.project().tracks.flatMap((t) => t.clips).find((c) => c.assetId === a.id);
    const transcript = await call("get_transcript", { clip_id: c.id });
    const fillers = await call("remove_filler_words", { clip_id: c.id });
    return {
      transcript: { ok: transcript.clip_id === c.id && transcript.words.some((w) => w.text === "um,"), transcript },
      agreement: { ok: fillers.heard === transcript.words.length && fillers.words.join() === "um," && fillers.removed === 1, fillers },
    };
  });
  details.once = { ok: hearings === 1, hearings };
  return { ok: Object.values(details).every((x) => x.ok), details };
};
