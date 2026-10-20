// Sound by stem, through window.videoEditor.mcp as an agent calls it
// (ADR-098; the documentary test's §3.F, §3.I and §5.3): a riser aimed
// into a gap on the voiceover lands on the SFX track instead, and the
// next effects reuse it; an ambience bed lands on the Ambience track,
// faded, its file reused for a second bed; describe_project and
// measure_loudness name each track's role; preview_audio answers a
// playable MP3 of the stretch asked for, with measurements that agree
// with the mix: the bed alone at its level, the voice alone where it
// speaks, every stem's loudness in the mix.
async (page) => {
  page.setDefaultTimeout(120000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const r = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const raw = async (name, args = {}) => {
      const r = await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? r.result.content[0].text}`);
      return r.result.content;
    };
    const call = async (name, args) => JSON.parse((await raw(name, args)).at(-1).text);
    const details = {};
    const [photo, voice, song] = await ve.import(["photo.jpg", "voice-8s.wav", "music-30s.mp3"].map((n) => ({ name: n, src: `${location.origin}/fixtures/media/${n}` })));
    await call("add_media_clip", { asset_id: photo.id, start: 0, duration: 20 });
    // A narrator with a gap at 4-12 s, on a dialog track; music under it all.
    const vo = await call("add_track", { kind: "audio", name: "Narration", role: "dialog" });
    const voTrack = vo.added_tracks[0].id;
    await call("add_media_clip", { asset_id: voice.id, start: 0, duration: 4, track_id: voTrack });
    await call("add_media_clip", { asset_id: voice.id, start: 12, in: 4, duration: 4, track_id: voTrack });
    await call("add_media_clip", { asset_id: song.id, start: 0, duration: 20 });
    await call("set_param", { clip_ids: [ve.describe().tracks.flatMap((t) => t.clips).find((c) => c.asset === song.id).id], path: "volume", value: 0.3 });
    await call("set_param", { clip_ids: ve.describe().tracks.find((t) => t.id === voTrack).clips.map((c) => c.id), path: "volume", value: 0.25 });

    // Effects: a riser into 12 s (the voice's gap) and hits; never on the narrator.
    const fx = await call("add_sound_effect", { sounds: [{ name: "rise", end_at: 12, volume: 0.2 }, { name: "impact", start: 12, volume: 0.2 }, { name: "whoosh", start: 3, volume: 0.2 }] });
    const where = (id) => ve.describe().tracks.find((t) => t.clips.some((c) => c.id === id));
    const fxTracks = fx.clip_ids.map((id) => where(id));
    details.effects = {
      ok: fxTracks.every((t) => t.role === "effects" && t.id !== voTrack && /^SFX/.test(t.name)) && fxTracks[0].id === fxTracks[1].id,
      tracks: fxTracks.map((t) => [t.name, t.role]),
    };
    const again = await call("add_sound_effect", { name: "pop", start: 18, volume: 0.2 });
    details.reused = { ok: where(again.clip_id).id === fxTracks[0].id && !again.added_tracks, track: where(again.clip_id).name };

    // Ambience: a waterfall 2-14 s, faded; a second bed of it reuses the file.
    const bed = await call("add_ambience", { name: "waterfall", start: 2, end: 14, fade_in: 1, fade_out: 2 });
    const bedTrack = ve.describe().tracks.find((t) => t.id === bed.track_id);
    const bedClip = bedTrack.clips[0];
    const proj = ve.project();
    const bedRaw = proj.tracks.flatMap((t) => t.clips).find((c) => c.id === bed.clip_ids[0]);
    details.ambience = {
      ok: bedTrack.role === "ambience" && bedTrack.name === "Ambience" && bedClip.start === 2 && bedClip.end === 14 && bedRaw.fadeIn === 30 && bedRaw.fadeOut === 60 && !bed.reused && bed.file_seconds >= 12,
      track: [bedTrack.name, bedTrack.role], clip: [bedClip.start, bedClip.end, bedRaw.fadeIn, bedRaw.fadeOut], file: bed.file_seconds,
    };
    const bed2 = await call("add_ambience", { name: "waterfall", start: 15, length: 4 });
    details.bedReused = { ok: bed2.reused && bed2.asset_id === bed.asset_id && ve.project().assets.filter((a) => a.sound?.id === "waterfall").length === 1 };
    // One undo takes the bed (and its file, when it made one) back.
    const before = ve.project().assets.length;
    await call("add_ambience", { name: "wind", start: 0, length: 3 });
    await raw("undo");
    details.undo = { ok: ve.project().assets.length === before && !ve.describe().tracks.some((t) => t.clips.some((c) => c.asset && ve.project().assets.find((a) => a.id === c.asset)?.sound?.id === "wind")) };

    // Roles in describe_project and measure_loudness.
    const roles = Object.fromEntries(ve.describe().tracks.filter((t) => t.kind === "audio").map((t) => [t.name, t.role]));
    const loud = await call("measure_loudness", { by_track: true, start: 0, end: 20 });
    details.roles = { ok: roles.Narration === "dialog" && roles.SFX === "effects" && roles.Ambience === "ambience" && Object.values(roles).includes("music") && loud.by_track.every((t) => t.role) && loud.balance?.dialog_tracks?.[0] === voTrack, roles, by_track: loud.by_track.map((t) => [t.name, t.role, t.integrated_lufs]) };

    // preview_audio: an MP3 the browser plays back at the length asked for.
    const decode = async (content) => {
      const audio = content.find((c) => c.type === "audio");
      const bytes = Uint8Array.from(atob(audio.data), (ch) => ch.charCodeAt(0));
      const ctx = new OfflineAudioContext(2, 48000, 48000);
      const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
      return { mime: audio.mimeType, kb: Math.round(bytes.length / 1024), seconds: buf.duration, buf };
    };
    const rms = (buf, a, b) => {
      const x = buf.getChannelData(0);
      let s = 0;
      for (let i = Math.floor(a * buf.sampleRate); i < Math.floor(b * buf.sampleRate); i++) s += x[i] * x[i];
      return 20 * Math.log10(Math.sqrt(s / ((b - a) * buf.sampleRate)) + 1e-9);
    };
    const mix = await raw("preview_audio", { start: 2, end: 14 });
    const mixSum = JSON.parse(mix.at(-1).text);
    const mixMp3 = await decode(mix);
    details.mix = {
      ok: mixMp3.mime === "audio/mpeg" && Math.abs(mixMp3.seconds - 12) < 0.2 && mixSum.per_second_lufs.length === 12 && ["dialog", "music", "effects", "ambience"].every((k) => typeof mixSum.stems[k] === "number") && mixSum.integrated_lufs > mixSum.stems.ambience,
      kb: mixMp3.kb, seconds: +mixMp3.seconds.toFixed(2), integrated: mixSum.integrated_lufs, stems: mixSum.stems, spectrum: mixSum.spectrum,
    };
    // The bed alone: at its made level (about -24 LUFS) once faded in, heard in the MP3 too.
    const amb = await raw("preview_audio", { start: 4, end: 12, solo: "ambience" });
    const ambSum = JSON.parse(amb.at(-1).text);
    const ambMp3 = await decode(amb);
    details.ambienceAlone = { ok: Math.abs(ambSum.integrated_lufs - -24) < 1.5 && ambSum.tracks.includes(bed.track_id) && !ambSum.silent.length && rms(ambMp3.buf, 1, 7) > -45, lufs: ambSum.integrated_lufs, mp3Db: +rms(ambMp3.buf, 1, 7).toFixed(1) };
    // The voice alone: speech at 2-4 and 12-14, silent in its gap.
    const vox = await call("preview_audio", { start: 2, end: 16, solo: "voice", audio: false });
    const gap = vox.silent.find(([a, b]) => a <= 4.5 && b >= 11.5);
    details.voiceAlone = { ok: !!gap && vox.per_second_lufs[0] !== null && vox.per_second_lufs[11] !== null && vox.tracks.length === 1, silent: vox.silent, first: vox.per_second_lufs[0] };
    // As exported at -14 LUFS: raised by the gain measure_loudness reports for it.
    const asExported = await call("preview_audio", { start: 2, end: 14, loudness: -14, audio: false });
    const whole = await call("measure_loudness", { loudness: -14 });
    details.asExported = { ok: asExported.as_exported_at === -14 && Math.abs(asExported.integrated_lufs - mixSum.integrated_lufs - whole.gain_db) < 1 && whole.gain_db > 2, mixed: mixSum.integrated_lufs, exported: asExported.integrated_lufs, gain_db: whole.gain_db };
    // It stops where the timeline does, and says so.
    const long = await call("preview_audio", { start: 0, end: 60, audio: false });
    details.capped = { ok: long.end === 20 && /timeline ends at 20/.test(long.note), end: long.end, note: long.note };
    return { ok: Object.values(details).every((d) => d.ok), details };
  });
  // The Audio tab lists the beds: Play previews one, + lays it from the playhead.
  const lib = page.getByRole("region", { name: "Library" });
  await lib.getByRole("tab", { name: "Audio", exact: true }).click();
  await page.getByRole("button", { name: "Play Rain" }).click();
  const before = await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).length);
  await page.evaluate(() => window.videoEditor.seek(30 * 16));
  await page.getByRole("button", { name: "Add Rain", exact: true }).click();
  await page.waitForFunction(() => window.videoEditor.project().assets.some((a) => a.sound?.id === "rain"), null, { timeout: 60000 });
  const rain = await page.evaluate(() => {
    const p = window.videoEditor.project();
    const a = p.assets.find((x) => x.sound?.id === "rain");
    const t = window.videoEditor.describe().tracks.find((x) => x.clips.some((c) => c.asset === a.id));
    const c = t.clips.find((x) => x.asset === a.id);
    return { track: t.name, role: t.role, start: c.start, end: c.end, clips: p.tracks.flatMap((x) => x.clips).length };
  });
  r.details.libraryCard = { ok: rain.role === "ambience" && rain.start === 16 && rain.end === 20 && rain.clips === before + 1, ...rain };
  r.ok = Object.values(r.details).every((d) => d.ok);
  return r;
}
