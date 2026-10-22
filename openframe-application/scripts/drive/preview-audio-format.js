// Playable previews, explicit formats and encoder failure fallback (ADR-135).
async (page) => {
  page.setDefaultTimeout(120000);
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const call = async (args) => {
    const r = await page.evaluate((args) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "preview_audio", arguments: args } }), args);
    if (r.error || r.result?.isError) throw new Error(JSON.stringify(r));
    const audio = r.result.content.find((c) => c.type === "audio");
    const summary = JSON.parse(r.result.content.find((c) => c.type === "text").text);
    const mime = { mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" };
    return { ok: !!audio?.data?.length && mime[summary.format] === audio.mimeType, format: summary.format, mimeType: audio?.mimeType, base64Length: audio?.data?.length, seconds: summary.seconds };
  };
  await page.evaluate(async () => {
    const v = window.videoEditor;
    const [a] = await v.import([{ src: "http://localhost:1420/fixtures/media/music-30s.mp3", name: "Preview music.mp3" }]);
    v.exec("add_media_clip", { asset_id: a.id, start: 0, duration: 2 });
  });
  details.default = await call({ start: 0, end: 1 });
  for (const format of ["mp3", "m4a", "wav"]) details[format] = await call({ start: 0, end: 1, format });
  details.wav.ok &&= details.wav.format === "wav";
  // Both WASM workers and native encoding fail, as on a restricted host.
  // Restore globals even if preview_audio fails so the drive cannot leave
  // the page with broken encoders.
  details.fallback = await page.evaluate(async () => {
    const worker = window.Worker, encoder = window.AudioEncoder;
    try {
      window.Worker = class { constructor() { throw new Error("Drive: encoder worker unavailable"); } };
      window.AudioEncoder = class {
        constructor() { throw new Error("Drive: native encoder unavailable"); }
        static async isConfigSupported() { return { supported: false }; }
      };
      const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "preview_audio", arguments: { start: 0, end: 1 } } });
      const audio = r.result?.content?.find((c) => c.type === "audio");
      const text = r.result?.content?.find((c) => c.type === "text")?.text;
      const summary = text && !r.result.isError ? JSON.parse(text) : {};
      const bytes = audio?.data ? Uint8Array.from(atob(audio.data), (c) => c.charCodeAt(0)) : new Uint8Array();
      const view = bytes.length > 44 && new DataView(bytes.buffer);
      return { ok: !r.error && !r.result?.isError && summary.format === "wav" && audio?.mimeType === "audio/wav" && view && view.getUint16(22, true) === 1 && view.getUint32(24, true) === 24000 && view.getUint16(34, true) === 16, format: summary.format, mimeType: audio?.mimeType, bytes: bytes.length, error: r.error ?? (r.result?.isError ? text : undefined) };
    } finally { window.Worker = worker; window.AudioEncoder = encoder; }
  });
  const measurements = await page.evaluate(() => window.videoEditor.mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "preview_audio", arguments: { start: 0, end: 1, audio: false, format: "wav" } } }));
  details.measurements = { ok: !measurements.result?.isError && measurements.result?.content?.every((c) => c.type === "text") };
  return { ok: Object.values(details).every((d) => d.ok), details };
}
