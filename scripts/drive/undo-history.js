// Undo history (VEGAS's undo list, Premiere's History panel): after three
// edits, right-clicking Undo lists them nearest first; choosing the third
// goes back past all three. Right-clicking Redo then lists them the other
// way; choosing the second brings two back. Escape closes the list.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const count = () => page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).length);
  // Three edits through the UI path (each one undo step).
  await page.evaluate(async () => {
    // The module instances the app loaded (after a hot update Vite serves
    // them as /src/x.ts?t=..., and a plain import gets a second copy).
    const loaded = performance.getEntriesByType("resource").map((e) => e.name);
    const mod = (path) => import(loaded.find((n) => new URL(n).pathname === path) ?? path);
    const { store } = await mod("/src/state/store.ts");
    const ops = await mod("/src/lib/project/ops.ts");
    const { createColorClip } = await mod("/src/lib/project/defaults.ts");
    for (const [i, color] of ["#a03030", "#30a030", "#3030a0"].entries())
      store.edit(`Add ${["red", "green", "blue"][i]}`, (p) => ops.addClip(p, ops.mainTrack(p).id, createColorClip(color, i * 30, 30)));
  });
  const details = { made: { ok: (await count()) === 3 } };
  const undo = page.locator('[data-history="undo"] button');
  await undo.click({ button: "right" });
  const items = await page.locator(".menu .menu-item .menu-label").allTextContents();
  details.listed = { ok: JSON.stringify(items.slice(0, 3)) === JSON.stringify(["Undo Add blue", "Undo Add green", "Undo Add red"]), items };
  await page.keyboard.press("Escape");
  details.escape = { ok: (await page.locator(".menu").count()) === 0 && (await count()) === 3 };
  await undo.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Undo Add red/ }).click();
  details.backToStart = { ok: (await count()) === 0 };
  await page.locator('[data-history="redo"] button').click({ button: "right" });
  const redo = await page.locator(".menu .menu-item .menu-label").allTextContents();
  details.redoListed = { ok: redo[0] === "Redo Add red" && redo[2] === "Redo Add blue", redo };
  await page.getByRole("menuitem", { name: /Redo Add green/ }).click();
  details.forwardTwo = { ok: (await count()) === 2 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
