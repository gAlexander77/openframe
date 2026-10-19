async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator('.create-card').click();
  const details = await page.evaluate(async () => {
    const ve = window.videoEditor, details = {};
    const module = async path => import(performance.getEntriesByType('resource').map(r => r.name).find(u => new URL(u).pathname === path) ?? path);
    const { imageFor } = await module('/src/engine/media.ts');
    for (const name of ['animated.gif', 'animated.webp', 'animated.apng']) {
      const [a] = await ve.import([{ name, src: `${location.origin}/fixtures/media/${name}` }]);
      details[name] = { ok: !!a?.animated && Math.abs(a.duration - 1) < 0.05, duration: a?.duration, animated: a?.animated };
      if (!a?.animated) continue;
      const pixels = async t => { const frame = await imageFor(a, t); const canvas = new OffscreenCanvas(32, 32); const ctx = canvas.getContext('2d'); ctx.drawImage(frame, 0, 0); return [...ctx.getImageData(0, 0, 32, 32).data]; };
      const first = await pixels(0), next = await pixels(0.41), loop = await pixels(1);
      details[`${name} timing`] = { ok: first.some((v, i) => v !== next[i]) && first.every((v, i) => v === loop[i]) };
      details[`${name} alpha`] = { ok: first[3] === 0, alpha: first[3] };
      ve.exec('add_media_clip', { asset_id: a.id, start: 0, duration: 2 });
    }
    ve.exec('set_project', { width: 128, height: 128 });
    ve.seek(0); await ve.rendered(); const first = ve.pixels().data;
    ve.seek(13); await ve.rendered(); const later = ve.pixels().data;
    ve.seek(30); await ve.rendered(); const loop = ve.pixels().data;
    details.playerFrames = { ok: first.some((v, i) => v !== later[i]) && first.every((v, i) => v === loop[i]) };
    const render = await ve.render({ format: 'webm', resolution: 'original', quality: 'recommended' });
    details.export = { ok: render.size > 100, size: render.size, frames: render.frames };
    const { platform } = await module('/src/platform/index.ts');
    const [file] = await platform.adoptFiles([new File([await (await fetch(render.url)).blob()], 'exported.webm')]);
    const { sourceFrames } = await module('/src/engine/analyze.ts');
    const samples = await sourceFrames({ id: 'export-test', name: 'exported.webm', src: file.src, kind: 'video', duration: 2, hasVideo: true, hasAudio: false }, [0, 0.41, 1], 128);
    const rgb = samples.map(frame => { const c = new OffscreenCanvas(128, 128); const ctx = c.getContext('2d'); ctx.drawImage(frame, 0, 0); return ctx.getImageData(0, 0, 128, 128).data; });
    const difference = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
    const motion = difference(rgb[0], rgb[1]), loopError = difference(rgb[0], rgb[2]);
    details.exportedFrames = { ok: motion > 1 && loopError < 5, motion, loopError };
    URL.revokeObjectURL(render.url);
    return details;
  });
  await page.locator('.hover-scrub').first().hover();
  details.hover = { ok: await page.locator('.hover-scrub canvas:not([hidden])').count() > 0 };
  return { ok: Object.values(details).every(x => x.ok), details };
}

