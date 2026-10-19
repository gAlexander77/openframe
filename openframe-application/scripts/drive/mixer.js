async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator('.create-card').click();
  await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: 'voice-8s.wav', src: `${location.origin}/fixtures/media/voice-8s.wav` }]);
    ve.exec('add_media_clip', { asset_id: a.id, start: 0 });
  });
  await page.getByRole('button', { name: 'Mixer', exact: true }).click();
  const fader = page.locator('.mix-fader input').first();
  const before = await page.evaluate(() => window.videoEditor.project().tracks.find(t => t.kind === 'audio').volume);
  const box = await fader.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(80);
  const changed = await page.evaluate(() => window.videoEditor.project().tracks.find(t => t.kind === 'audio').volume);
  await page.evaluate(() => window.videoEditor.action('undo'));
  const undone = await page.evaluate(() => window.videoEditor.project().tracks.find(t => t.kind === 'audio').volume);
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  const muted = await page.evaluate(() => window.videoEditor.project().tracks.find(t => t.kind === 'audio').muted);
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  const solo = await page.evaluate(() => window.videoEditor.project().tracks.find(t => t.kind === 'audio').solo);
  await page.evaluate(() => { window.videoEditor.seek(65); window.videoEditor.action('playPause'); });
  let peak = -60;
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(100); peak = Math.max(peak, await page.locator('.mix-strip').first().locator('meter').evaluate(e => e.value)); }
  await page.evaluate(() => window.videoEditor.action('playPause'));
  const details = { oneUndo: { ok: changed !== before && undone === before, before, changed, undone }, mute: { ok: muted }, solo: { ok: solo }, liveMeter: { ok: peak > -50, peak } };
  return { ok: Object.values(details).every(x => x.ok), details };
}
