// Headless frontend contract check using the installed Tauri drag script and
// @tauri-apps/api/mocks. Pass { drag, mocks } from the local test runner.
// IPC is simulated: this does not prove Windows moved or resized a window.
async (page, { drag, mocks }) => {
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1600, height: 950 });
  const setup = () => {
    window.headerCalls = [];
    window.headerMaximized = sessionStorage.getItem('header-initial-maximized') === 'true';
    window.headerProjects = new Map();
    mockIPC((cmd, args) => {
      window.headerCalls.push(cmd);
      if (cmd === 'plugin:window|is_maximized') return window.headerMaximized;
      if (cmd === 'plugin:window|toggle_maximize' || cmd === 'plugin:window|internal_toggle_maximize') {
        window.headerMaximized = !window.headerMaximized;
        void window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://resize', payload: { width: 1600, height: 950 } });
      }
      if (cmd === 'project_list') return [...window.headerProjects.values()].map(p => p.summary);
      if (cmd === 'project_save') window.headerProjects.set(args.id, { project: args.project, summary: JSON.parse(args.summary) });
      if (cmd === 'project_load') return window.headerProjects.get(args.id)?.project;
      if (cmd === 'render_job') return null;
    }, { shouldMockEvents: true });
    mockWindows('main');
    mockConvertFileSrc('windows');
  };
  await page.addInitScript({ content: `${mocks}\n(${setup})();\n${drag}` });
  await page.goto('http://localhost:1420');
  await page.locator('.create-card').waitFor();
  const details = {};
  const reset = () => page.evaluate(() => { window.headerCalls = []; });
  const gestures = () => page.evaluate(() => window.headerCalls.filter(c => /start_dragging|toggle_maximize/.test(c)));
  const click = async (label, selector, options) => {
    await reset();
    await page.locator(selector).click(options);
    const calls = await gestures();
    details[label] = { ok: calls.length === 1 && calls[0] === 'plugin:window|start_dragging', calls };
  };
  await click('home logo drags', '.app-mark');
  await click('home title drags', '.home-title');
  await click('home right gap drags', '.titlebar-right', { position: { x: 10, y: 20 } });
  const doubleClick = async (label, selector, options) => {
    await reset();
    await page.locator(selector).dblclick(options);
    const maximized = await page.evaluate(() => window.headerMaximized);
    const calls = await gestures();
    details[label] = { ok: calls.filter(c => c === 'plugin:window|internal_toggle_maximize').length === 1, maximized, calls };
  };
  await doubleClick('home double click maximizes', '.home-title');
  details['home double click maximizes'].ok &&= await page.evaluate(() => window.headerMaximized);
  await page.getByRole('button', { name: 'Restore', exact: true }).waitFor();
  details['double click updates restore control'] = { ok: await page.locator('.window-controls .lucide-copy').isVisible() };
  await doubleClick('home double click restores', '.home-title');
  details['home double click restores'].ok &&= await page.evaluate(() => !window.headerMaximized);
  await page.getByRole('button', { name: 'Maximize', exact: true }).waitFor();
  details['restore updates maximize control'] = { ok: await page.locator('.window-controls .lucide-square').isVisible() };
  await page.locator('.create-card').click();
  await page.locator('.save-state').waitFor();
  await click('editor save status drags', '.save-state');
  await click('editor logo drags', '.app-mark');
  await click('editor left gap drags', '.titlebar-left', { position: { x: 400, y: 10 } });
  await click('editor right gap drags', '.titlebar-right', { position: { x: 10, y: 20 } });
  await doubleClick('editor status double click maximizes', '.save-state');
  await doubleClick('editor right gap double click restores', '.titlebar-right', { position: { x: 10, y: 20 } });
  await reset();
  await page.locator('.project-name').click();
  await page.locator('.project-name-input').fill('Header check');
  await page.locator('.project-name-input').press('Enter');
  details['rename remains interactive'] = { ok: (await gestures()).length === 0 && await page.locator('.project-name').textContent() === 'Header check' };
  await reset();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.locator('.menu-sep').first().click({ force: true });
  details['menu and separator do not drag'] = { ok: (await gestures()).length === 0 && await page.locator('.menu').isVisible() };
  await page.keyboard.press('Escape');
  await reset();
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  details['header button remains interactive'] = { ok: (await gestures()).length === 0 && await page.getByRole('dialog').isVisible() };
  await page.keyboard.press('Escape');
  await reset();
  await page.getByRole('button', { name: 'Maximize', exact: true }).click();
  const calls = await gestures();
  details['maximize button does not also drag'] = { ok: calls.length === 1 && calls[0] === 'plugin:window|toggle_maximize', calls };
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: 'Maximize', exact: true }).waitFor();
  details['restore button updates state'] = { ok: await page.evaluate(() => !window.headerMaximized) };
  await reset();
  await page.evaluate(() => {
    window.headerMaximized = true;
    return window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://resize', payload: { width: 1920, height: 1080 } });
  });
  await page.getByRole('button', { name: 'Restore', exact: true }).waitFor();
  details['external resize updates control without clicking'] = { ok: (await gestures()).length === 0 };
  await page.evaluate(() => sessionStorage.setItem('header-initial-maximized', 'true'));
  await page.reload();
  await page.getByRole('button', { name: 'Restore', exact: true }).waitFor();
  details['initial maximized window shows restore'] = { ok: await page.locator('.window-controls .lucide-copy').isVisible() };
  return { ok: Object.values(details).every(d => d.ok), verification: 'Headless Playwright MCP; installed Tauri Windows drag handler; simulated IPC only', details };
}
