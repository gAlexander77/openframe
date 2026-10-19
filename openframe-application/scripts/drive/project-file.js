async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator('.create-card').click();
  const project = await page.evaluate(() => { const ve = window.videoEditor; ve.exec('add_color_clip', { color: '#448866', start: 0, duration: 3 }); return ve.project(); });
  const picker = page.waitForEvent('filechooser');
  await page.locator('.menubar-button', { hasText: /^File$/ }).click();
  await page.getByRole('menuitem', { name: 'Open project file', exact: false }).click();
  await (await picker).setFiles({ name: 'collected.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...project, name: 'Opened file' })) });
  await page.waitForFunction(() => window.videoEditor.project().name === 'Opened file');
  const result = await page.evaluate(() => window.videoEditor.project());
  const web = await page.evaluate(async () => { try { await window.videoEditor.exec('collect_project'); return ''; } catch (e) { return e.message; } });
  const details = { freshIdentity: { ok: result.id !== project.id }, contents: { ok: result.tracks.some(t => t.clips.some(c => c.color === '#448866')) }, desktopCommand: { ok: /desktop only/.test(web), message: web } };
  return { ok: Object.values(details).every(x => x.ok), details };
}
