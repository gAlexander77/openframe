// Headless regression checks for the icon vocabulary and minimum-window layout.
async (page) => {
  page.setDefaultTimeout(6000);
  const details = {};
  const check = (name, ok, seen) => { details[name] = { ok, seen }; };
  await page.context().route('**/api/tags', (r) => r.fulfill({ json: { models: [{ name: 'llama3.1:8b' }] } }));
  await page.locator('.create-card').click();
  await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec('set_project', { name: 'Polish focus sample' });
    v.exec('add_color_clip', { color: '#4488aa', start: 0, duration: 5 });
    v.exec('add_text', { text: 'Layout sample', start: 0, duration: 3 });
  });
  for (const [width, height] of [[1600, 950], [1280, 720], [1100, 680]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    const tabs = page.locator('.lib-tab');
    const clipped = await tabs.evaluateAll((nodes) => nodes.filter((e) => {
      const r = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect();
      return r.left < p.left - 1 || r.right > p.right + 1 || r.top < p.top - 1 || r.bottom > p.bottom + 1;
    }).map((e) => e.textContent));
    for (const tab of await tabs.all()) { await tab.click(); }
    check(`${width}-all-library-tabs`, clipped.length === 0 && await tabs.count() === 12, clipped); // 12 with Check (ADR-111)
    for (const kind of ['details', 'text']) {
      await page.evaluate((kind) => {
        const v = window.videoEditor;
        v.select(kind === 'text' ? [v.project().tracks.flatMap((t) => t.clips).find((c) => c.type === 'text').id] : []);
      }, kind);
      if (kind === 'text') await page.getByRole('region', { name: 'Inspector' }).getByRole('tab', { name: 'Text', exact: true }).click();
      await page.waitForTimeout(100);
      const overflow = await page.locator('.inspector-panel').evaluate((panel) => {
        const box = panel.getBoundingClientRect();
        return [...panel.querySelectorAll('button,input,select,textarea')].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width && r.height && (r.left < box.left - 1 || r.right > box.right + 1 || e.scrollWidth > e.clientWidth + 2 && !e.matches('input,select,textarea'));
        }).map((e) => e.getAttribute('aria-label') || e.textContent.trim());
      });
      check(`${width}-${kind}-contained`, !overflow.length, overflow);
    }
    const letters = await page.locator('button').evaluateAll((nodes) => nodes.filter((e) => e.getBoundingClientRect().width && /^[A-Za-z]$/.test(e.textContent.trim()) && !e.querySelector('svg')).map((e) => e.outerHTML));
    check(`${width}-no-letter-buttons`, !letters.length, letters);
    check(`${width}-total-time-visible`, await page.locator('.tc-total').isVisible());
    await page.screenshot({ path: `__REPO__/scratch/icons-layout-${width}.png` });
  }
  // Roving focus changes the selected radio and wraps at either end.
  const align = page.getByRole('radio', { name: 'Left', exact: true });
  await align.focus();
  await page.keyboard.press('ArrowRight');
  check('segmented-arrow-selects', await page.getByRole('radio', { name: 'Center', exact: true }).getAttribute('aria-checked') === 'true');
  check('segmented-roving-focus', await page.getByRole('radio', { name: 'Center', exact: true }).evaluate((e) => e === document.activeElement && e.tabIndex === 0));
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  check('segmented-wraps', await align.getAttribute('aria-checked') === 'true');
  // Tool faces and selected-tool hints agree for all trim tools.
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => new URL(u).pathname.endsWith('/src/state/store.ts'));
    window.polishStore = (await import(url)).store;
  });
  const tools = {};
  for (const tool of ['ripple', 'roll', 'slip', 'slide']) {
    await page.evaluate((tool) => window.polishStore.set({ tool }), tool);
    tools[tool] = await page.locator('.tool-btn').evaluate((e) => !!e.querySelector('svg') && e.textContent.trim() === '' && e.dataset.tip.toLowerCase().includes(window.polishStore.get().tool));
  }
  check('trim-tool-icons', Object.values(tools).every(Boolean), tools);
  await page.evaluate(() => { window.polishStore.set({ tool: 'select' }); window.videoEditor.seek(0); });
  check('split-disabled-at-edge', await page.getByRole('button', { name: 'Split', exact: true }).isDisabled());
  await page.evaluate(() => window.videoEditor.seek(30));
  check('split-enabled-inside', await page.getByRole('button', { name: 'Split', exact: true }).isEnabled());
  // Keep the audio lane reachable while the graph is docked at 1280 x 720.
  await page.setViewportSize({ width: 1280, height: 720 });
  const audio = await page.evaluate(async () => {
    const v = window.videoEditor;
    const [a] = await v.import([{ name: 'voice-8s.wav', src: `${location.origin}/fixtures/media/voice-8s.wav` }]);
    v.exec('add_media_clip', { asset_id: a.id, start: 0, duration: 5 });
    const c = v.project().tracks.flatMap((t) => t.clips).find((c) => c.type === 'audio');
    v.select([c.id]);
    v.action('toggleKeyframePanel');
    return c.id;
  });
  await page.locator('.kf-dock').waitFor();
  await page.waitForTimeout(200);
  await page.locator(`[data-clip="${audio}"]`).scrollIntoViewIfNeeded();
  const lanes = await page.locator('.tl-scroll').evaluate((e) => ({ height: e.clientHeight, bottom: e.getBoundingClientRect().bottom }));
  const audioBox = await page.locator(`[data-clip="${audio}"]`).boundingBox();
  const graph = await page.locator('.kf-dock').boundingBox();
  check('keyframes-leave-audio-reachable', lanes.height >= 120 && audioBox.y + audioBox.height <= graph.y + 1, { lanes, audioBox, graph });
  const quick = await page.locator('.kf-quick').evaluate((e) => {
    const r = e.getBoundingClientRect(), p = e.closest('.kf-empty').getBoundingClientRect();
    return r.top >= p.top - 1 && r.bottom <= p.bottom + 1;
  });
  check('compact-keyframe-empty-state-visible', quick);
  await page.screenshot({ path: '__REPO__/scratch/icons-layout-keyframes.png' });
  await page.evaluate(() => window.videoEditor.action('toggleKeyframePanel'));
  // Editing a marker must retain several list rows instead of collapsing it.
  await page.getByRole('tab', { name: 'Markers', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 6; i++) window.videoEditor.exec('add_marker', { at: i, label: `Layout marker ${i}` });
  });
  await page.getByRole('button', { name: /^Go to Layout marker 0/ }).click();
  const listHeight = await page.locator('.marker-list').evaluate((e) => e.clientHeight);
  check('marker-editor-keeps-list', listHeight >= 132, listHeight);
  // Search should not resize the keyboard shortcuts dialog.
  await page.evaluate(() => window.videoEditor.action('showShortcuts'));
  // Measure after the dialog's scale-in, or its first box is mid-animation.
  await page.locator('.shortcuts-panel').evaluate((e) => Promise.all(e.getAnimations({ subtree: true }).map((a) => a.finished)));
  const initial = await page.locator('.shortcuts-panel').boundingBox();
  await page.getByLabel('Search keyboard shortcuts').fill('no-such-polish-shortcut');
  const filtered = await page.locator('.shortcuts-panel').boundingBox();
  check('shortcuts-stable-height', Math.abs(initial.height - filtered.height) < 1, { initial, filtered });
  await page.keyboard.press('Escape');
  await page.locator('.menubar-item > button', { hasText: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Back to home' }).click();
  const card = page.locator('.project-card').first();
  await card.waitFor();
  await page.keyboard.press('Tab');
  await card.focus();
  const ring = await card.evaluate((e) => ({ focused: e.matches(':focus-visible'), ring: getComputedStyle(e.querySelector('.project-thumb'), '::after').boxShadow, tip: e.querySelector('.project-card-name').getAttribute('data-tip') }));
  check('home-focus-ring-above-thumbnail', ring.focused && ring.ring.includes('2px') && !!ring.tip, ring);
  await page.screenshot({ path: '__REPO__/scratch/icons-layout-home-focus.png' });
  return { ok: Object.values(details).every((d) => d.ok), details };
}
