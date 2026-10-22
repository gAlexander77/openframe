async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator('.create-card').click();
  const details = await page.evaluate(async () => {
    const ve = window.videoEditor, details = {};
    const module = async path => import(performance.getEntriesByType('resource').map(r => r.name).find(u => new URL(u).pathname === path) ?? path);
    const { borrowImage } = await module('/src/engine/media.ts');
    const { CursorPool, resolveSources } = await module('/src/engine/player.ts');
    const { planFrame } = await module('/src/lib/render/plan.ts');
    const { closeAnimation } = await module('/src/engine/animatedImage.ts');
    const { memorySnapshot } = await module('/src/engine/memory.ts');
    const { platform } = await module('/src/platform/index.ts');
    const { sourceFrames } = await module('/src/engine/analyze.ts');
    ve.exec('set_project', { width: 128, height: 128 });
    for (const name of ['animated.gif', 'animated.webp', 'animated.apng']) {
      const [a] = await ve.import([{ name, src: `${location.origin}/fixtures/media/${name}` }]);
      details[name] = { ok: !!a?.animated && Math.abs(a.duration - 1) < 0.05, duration: a?.duration, animated: a?.animated };
      if (!a?.animated) continue;
      const pixels = async t => {
        const borrowed = await borrowImage(a, t);
        try {
          const canvas = new OffscreenCanvas(32, 32), ctx = canvas.getContext('2d');
          ctx.drawImage(borrowed.value, 0, 0);
          return [...ctx.getImageData(0, 0, 32, 32).data];
        } finally { borrowed.release(); }
      };
      const first = await pixels(0), next = await pixels(0.41), loop = await pixels(1);
      details[`${name} timing`] = { ok: first.some((v, i) => v !== next[i]) && first.every((v, i) => v === loop[i]) };
      details[`${name} alpha`] = { ok: first[3] === 0, alpha: first[3] };
      ve.exec('add_media_clip', { asset_id: a.id, start: 0, duration: 2 });
      ve.seek(0); await ve.rendered(); const playerFirst = ve.pixels().data;
      ve.seek(13); await ve.rendered(); const later = ve.pixels().data;
      ve.seek(30); await ve.rendered(); const playerLoop = ve.pixels().data;
      details[`${name} playerFrames`] = { ok: playerFirst.some((v, i) => v !== later[i]) && playerFirst.every((v, i) => v === playerLoop[i]) };
      const render = await ve.render({ format: 'webm', resolution: 'original', quality: 'recommended' });
      details[`${name} export`] = { ok: render.size > 100, size: render.size, frames: render.frames };
      try {
        const [file] = await platform.adoptFiles([new File([await (await fetch(render.url)).blob()], 'exported.webm')]);
        const samples = await sourceFrames({ id: 'export-test', name: 'exported.webm', src: file.src, kind: 'video', duration: 2, hasVideo: true, hasAudio: false }, [0, 0.41, 1], 128);
        const rgb = samples.map(frame => { const c = new OffscreenCanvas(128, 128); const ctx = c.getContext('2d'); ctx.drawImage(frame, 0, 0); return ctx.getImageData(0, 0, 128, 128).data; });
        const difference = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
        const motion = difference(rgb[0], rgb[1]), loopError = difference(rgb[0], rgb[2]);
        details[`${name} exportedFrames`] = { ok: motion > 1 && loopError < 5, motion, loopError };
      } finally { ve.releaseUrl(render.url); }
      // Evict the loop while both viewer and a separate plan borrow it.
      // Removing its clip must release both borrowers and close its bitmaps.
      const pool = new CursorPool(), project = ve.project();
      try {
        const resolved = await resolveSources(project, planFrame(project, 0), pool);
        const bitmap = [...resolved.values()].find(r => r.bitmap)?.bitmap;
        closeAnimation(a.src);
        const retained = memorySnapshot().kinds.animated_image_borrows.bytes;
        const usable = bitmap?.width > 0;
        ve.exec('delete_clips', { clip_ids: project.tracks.flatMap(t => t.clips).map(c => c.id) });
        await ve.rendered();
        await resolveSources(ve.project(), [], pool);
        details[`${name} released`] = { ok: usable && retained > 0 && bitmap.width === 0 && memorySnapshot().kinds.animated_image_borrows.bytes === 0, retained };
      } finally { pool.clear(); }
    }
    return details;
  });
  await page.locator('.hover-scrub').first().hover();
  details.hover = { ok: await page.locator('.hover-scrub canvas:not([hidden])').count() > 0 };
  return { ok: Object.values(details).every(x => x.ok), details };
}

