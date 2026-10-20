// A clip of a whole file relinks to that file and does not slip past its
// ends (ADR-117), through window.videoEditor.mcp as an agent calls it. A
// sound's clip runs to the frame its last sample plays in (ADR-113) and a
// picture's to the nearer frame, so a 6.435 s voice is 194 frames (6.467
// s): relink_media refused it its own file ("must be at least 6.467
// seconds long to cover the clips"), and slip_clip moved it to in -0.032
// s. A video that reads 5.013 s is 150 frames and slips the 0.013 s left.
async (page) => {
  page.setDefaultTimeout(120000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  return page.evaluate(async () => {
    const ve = window.videoEditor;
    const call = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) return { error: r.error?.message ?? r.result.content[0].text };
      return JSON.parse(r.result.content.at(-1).text);
    };
    const details = {};
    for (const name of ["speech-test.wav", "h264-aac.mkv"]) {
      const src = `${location.origin}/fixtures/media/${name}`;
      const [a] = await ve.import([{ name, src }]);
      const [b] = await ve.import([{ name: `copy of ${name}`, src }]);
      const added = await call("add_media_clip", { asset_id: a.id, start: 0, ...(name.endsWith(".wav") ? { track_id: (await call("add_track", { kind: "audio", name: "Voice" })).added_tracks[0].id } : {}) });
      const clip = added.added_clips[0];
      const relinked = await call("relink_media", { asset_id: a.id, replacement_asset_id: b.id });
      const slipped = await call("slip_clip", { clip_id: clip.id, by: 1 });
      const now = ve.project().tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id);
      const end = now.in + (clip.end - clip.start);
      // Inside the file, or (a sound) its last frame starting inside it.
      const inside = now.in >= 0 && (end <= a.duration + 1e-6 || (now.in === 0 && end - 1 / 30 < a.duration));
      details[name] = { ok: !relinked.error && inside && /source ends there/.test(slipped.notes?.[0] ?? ""), duration: a.duration, clip: [clip.start, clip.end], relinked: relinked.error ?? "relinked", in: now.in, slip: slipped.notes ?? slipped.error };
      await call("delete_clips", { clip_ids: [clip.id] });
    }
    return { ok: Object.values(details).every((d) => d.ok), details };
  });
};
