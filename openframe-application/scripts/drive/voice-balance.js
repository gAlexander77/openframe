// Real built-in speech synthesis plus the standard music fixture, over MCP.
async (page, opts = {}) => {
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator('.create-card').click();
  const call = async (name, args = {}) => {
    const r = await page.evaluate(([name,args]) => window.videoEditor.mcp({ jsonrpc:'2.0', id:1, method:'tools/call', params:{name,arguments:args} }), [name,args]);
    if (r.result?.isError || r.error) throw new Error(name + ': ' + JSON.stringify(r));
    return JSON.parse(r.result.content[0].text);
  };
  const clipId = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{name:'music-30s.mp3',src:'http://localhost:1420/fixtures/media/music-30s.mp3'}]);
    ve.exec('add_media_clip',{asset_id:a.id,start:0});
    return ve.describe().tracks.flatMap(t=>t.clips).find(c=>c.type==='audio').id;
  });
  const voice = opts.recorded ? await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{name:'speech-test.wav', src:'http://localhost:1420/fixtures/media/speech-test.wav'}]);
    ve.exec('add_track',{kind:'audio',name:'Voiceover'});
    const track = ve.project().tracks.find(t=>t.name==='Voiceover');
    ve.exec('add_media_clip',{asset_id:a.id,track_id:track.id,start:1});
    return {lines:[{start:1,end:1+a.duration}]};
  }) : await call('add_voiceover', { start: 1, lines: [{ text:'Build your next story with clear words and music. Every cut brings your ideas to life.' }] });
  const start = voice.lines[0].start, end = voice.lines.at(-1).end;
  const before = await call('measure_loudness',{start,end,by_track:true});
  const duck = await call('duck_under_speech',{clip_id:clipId,voice_above_music_lu:10});
  const after = await call('measure_loudness',{start:duck.balance.start,end:duck.balance.end,by_track:true});
  const details = {
    stems: { ok: before.by_track.length >= 2 && before.by_track.every(t=>Number.isFinite(t.integrated_lufs) && t.short_term.length > 0), tracks:before.by_track },
    target: { ok: duck.balance.met && Math.abs(after.balance.voice_above_music_lu-10)<=0.6, before:before.balance, duck, after:after.balance },
  };
  await call('undo');
  const undone = await call('measure_loudness',{start,end,by_track:true});
  details.undo = { ok: Math.abs(undone.balance.voice_above_music_lu-before.balance.voice_above_music_lu)<0.2 };
  return { speech_source: opts.recorded ? 'recorded fixture' : 'add_voiceover', ok:Object.values(details).every(d=>d.ok),details};
}
