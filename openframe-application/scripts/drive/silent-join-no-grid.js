// No beat grid: a join fading into a breath can roll into nearby silence
// in both files. Generated WAVs make the location and expected fix exact.
async (page) => {
  page.setDefaultTimeout(180000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  return page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? r.result.content[0].text}`);
      return JSON.parse(r.result.content.at(-1).text);
    };
    const { encodeWav } = await import("/src/lib/wav.ts");
    const urls = [];
    try {
      const files = ["outgoing", "incoming"].map((name, k) => {
        const pcm = Float32Array.from({ length: 8 * 48000 }, (_, i) => {
          const t = i / 48000;
          const silent = k ? (t >= 4.8 && t < 5) || (t >= 5.2 && t < 5.45) : t >= 3.2 && t < 3.45;
          return silent ? 0 : 0.3 * Math.sin(t * Math.PI * 440);
        });
        return new File([encodeWav([pcm], 48000)], `${name}.wav`, { type: "audio/wav" });
      });
      // ve.import takes paths and http(s) URLs; generated files go through
      // the app's own import, by the URL the app loaded it from.
      const loaded = performance.getEntriesByType("resource").map((e) => e.name);
      const { adoptAndImport } = await import(loaded.find((n) => new URL(n).pathname === "/src/state/media.ts") ?? "/src/state/media.ts");
      const [outgoing, incoming] = await adoptAndImport(files);
      // An empty track is tidied away at once, so take its id from the answer.
      const added = await call("add_track", { kind: "audio", name: "No grid", role: "music" });
      const track = added.added_tracks[0].id;
      await call("add_media_clip", { asset_id: outgoing.id, start: 0, in: 1, duration: 2, track_id: track });
      await call("add_media_clip", { asset_id: incoming.id, start: 2, in: 5, duration: 2, track_id: track });
      const a = ve.project().tracks.find(t => t.id === track).clips[0].id;
      await call("set_crossfade", { clip_id: a, seconds: 0.03 });
      const before = await call("preview_audio", { start: 0.5, end: 3.5, audio: false });
      const edge = before.edges?.find(e => e.kind === "join"), fix = edge?.fix;
      const target = fix?.args?.to;
      const details = { noGrid: { ok: ve.project().markers.length === 0 && ve.project().assets.every(a => !a.musicGrid) }, hint: { ok: fix?.tool === "roll_edit" && target >= 2.2 && target <= 2.45 && /nearby silent stretch/.test(edge.verdict), edge } };
      if (fix?.tool === "roll_edit") {
        await call(fix.tool, fix.args);
        const after = await call("preview_audio", { start: 0.5, end: 3.5, audio: false });
        details.rolled = { ok: !after.edges?.some(e => e.kind === "join" && /hole|click|dropout/.test(e.verdict)), edges: after.edges };
      }
      return { ok: Object.values(details).every(d => d.ok), details };
    } finally { urls.forEach(u => URL.revokeObjectURL(u)); }
  });
};
