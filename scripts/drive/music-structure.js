// Requires the private test track and its cues.json copied into scratch/.
async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator('.create-card').click();
  const { result, cues } = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [asset] = await ve.import([{ name: 'promo.wav', src: 'http://localhost:1420/scratch/openframe-promo-120bpm.wav' }]);
    ve.exec('add_media_clip', { asset_id: asset.id, start: 0 });
    const clip = ve.describe().tracks.flatMap(t => t.clips).find(c => c.type === 'audio');
    const rpc = await ve.mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'analyze_music', arguments: { clip_id: clip.id } } });
    if (rpc.result.isError) throw new Error(rpc.result.content[0].text);
    return { result: JSON.parse(rpc.result.content[0].text), cues: await (await fetch('http://localhost:1420/scratch/cues.json')).json() };
  });
  const bar = cues.bar_seconds;
  const details = {
    drops: { ok: result.drops.length === cues.drops.length && cues.drops.every((t,i) => Math.abs(t-result.drops[i]) <= bar), actual: result.drops },
    sections: { ok: result.sections.length === cues.sections.length && cues.sections.every((s,i) => Math.abs(s.start-result.sections[i].start) <= bar && Math.abs(s.end-result.sections[i].end) <= bar && result.sections[i].label === s.name.toLowerCase().split(' ')[0]), actual: result.sections },
    biggest: { ok: Math.abs(result.drop - 36) <= bar, actual: result.drop },
  };
  return { ok: Object.values(details).every(d => d.ok), details };
}
