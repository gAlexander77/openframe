async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator('.create-card').click();
  await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [asset] = await ve.import([{ name: 'h264-1080p30.mp4', src: `${location.origin}/fixtures/media/h264-1080p30.mp4` }]);
    ve.exec('add_media_clip', { asset_id: asset.id, start: 0, duration: 3 });
    ve.exec('update_track', { track_id: ve.project().tracks.find(t => t.clips.length).id, color: 'purple' });
  });
  const tint = await page.locator('.clip').getAttribute('data-label');
  const initialHeight = (await page.locator('.clip').boundingBox()).height;
  const toggle = async name => {
    await page.getByRole('button', { name: 'Timeline display', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  };
  await toggle('Show waveforms');
  const noWave = await page.locator('.clip-wave').count() === 0;
  await toggle('Show waveforms');
  const waveBack = await page.locator('.clip-wave').count() > 0;
  await toggle('Show video thumbnails');
  const noThumb = await page.locator('.clip-strip').count() === 0;
  await toggle('Show video thumbnails');
  const thumbBack = await page.locator('.clip-strip').count() > 0;
  await toggle('Show clip names');
  const hidden = await page.locator('.clip-name').count() === 0;
  await toggle('Large track height');
  const height = (await page.locator('.clip').boundingBox()).height;
  await page.evaluate(() => { const ve = window.videoEditor; const c = ve.project().tracks.flatMap(t => t.clips)[0]; ve.exec('set_clip_label', { clip_ids: [c.id], label: 'red' }); });
  const labelWins = await page.locator('.clip').getAttribute('data-label') === 'red';
  await page.reload(); await page.waitForFunction(() => !!window.videoEditor);
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('video-editor.timeline-display')));
  const details = { tint: { ok: tint === 'purple' }, clipOverride: { ok: labelWins }, waveforms: { ok: noWave && waveBack }, thumbnails: { ok: noThumb && thumbBack }, names: { ok: hidden }, height: { ok: height > initialHeight, initialHeight, height }, persisted: { ok: prefs.names === false && prefs.height === 'large', prefs } };
  return { ok: Object.values(details).every(x => x.ok), details };
}
