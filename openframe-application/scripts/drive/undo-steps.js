// One drag, one undo step (ADR-072). Every range slider the inspector
// shows for a video, a title and a sound (every tab, every Adjust part,
// every animation slot, an effect and a transition), and the track volume
// and pan, is dragged across several values with the mouse; each must
// leave exactly one undo step. The color picker's live inputs (what the
// platform picker sends while its square is dragged) must make one too,
// and the Animation tab's Duration drag from 1.2 to 2.0 s, the case found
// while recording the launch film, one "In animation" step. A held arrow
// key is one step, and a value set with no press at all is one too.
async (page) => {
  page.setDefaultTimeout(6000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const loaded = performance.getEntriesByType("resource").map((e) => e.name);
    const mod = (path) => import(loaded.find((n) => new URL(n).pathname === path) ?? path);
    window.__store = (await mod("/src/state/store.ts")).store;
    const [v, m] = await ve.import([
      { name: "h264-aac.mkv", src: `${location.origin}/fixtures/media/h264-aac.mkv` },
      { name: "music-30s.mp3", src: `${location.origin}/fixtures/media/music-30s.mp3` },
    ]);
    ve.exec("add_media_clip", { asset_id: v.id, start: 0, duration: 4 });
    ve.exec("add_media_clip", { asset_id: v.id, start: 4, duration: 4 });
    ve.exec("add_media_clip", { asset_id: m.id, start: 0, duration: 8 });
    ve.exec("add_text", { text: "Undo steps", start: 0, duration: 6 });
    const clips = ve.project().tracks.flatMap((t) => t.clips);
    const video = clips.find((c) => c.type === "video" && c.start === 0).id;
    ve.exec("add_effect", { clip_id: video, type: "glow" });
    ve.exec("set_transition", { clip_id: video, type: "dissolve", duration: 0.5 });
    return { video, text: clips.find((c) => c.type === "text").id, audio: clips.find((c) => c.type === "audio").id };
  });
  const count = () => page.evaluate(() => window.__store.history().undo.length);
  const inspector = page.getByRole("region", { name: "Inspector" });
  const results = [];

  // Drag one slider from 30% to 70% of its track in eight moves.
  const drag = async (input, where) => {
    await input.scrollIntoViewIfNeeded();
    const b = await input.boundingBox();
    if (!b || b.width < 20) return;
    const name = (await input.getAttribute("aria-label")) ?? "slider";
    const before = await count();
    const v0 = await input.inputValue();
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + b.width * 0.3, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width * (0.3 + i * 0.05), y);
    await page.mouse.up();
    await page.waitForTimeout(50); // the gesture closes just after the release
    const steps = (await count()) - before;
    const changed = v0 !== (await input.inputValue().catch(() => v0));
    results.push({ where, name, steps, changed, pass: changed ? steps === 1 : steps <= 1 });
  };
  const openAll = async () => {
    for (let i = 0; i < 12; i++) {
      const closed = inspector.locator(".insp-section-toggle[aria-expanded=false]");
      if (!(await closed.count())) break;
      await closed.first().click();
    }
  };
  const sliders = async (where) => {
    await openAll();
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      const all = inspector.locator('input[type="range"]');
      const n = await all.count();
      let next = null;
      for (let j = 0; j < n; j++) {
        const label = (await all.nth(j).getAttribute("aria-label")) ?? `#${j}`;
        if (!seen.has(label)) {
          seen.add(label);
          next = all.nth(j);
          break;
        }
      }
      if (!next) break;
      await drag(next, where);
    }
  };
  const tab = async (name) => {
    const t = inspector.getByRole("tab", { name, exact: false });
    if (!(await t.count())) return false;
    await t.first().click();
    return true;
  };
  const visit = async (clipId, label) => {
    await page.evaluate((id) => window.videoEditor.select([id]), clipId);
    const names = await inspector.getByRole("tab").allTextContents();
    for (const raw of names) {
      const name = raw.replace(/\s*\(\d+\)$/, "");
      await tab(name);
      if (name === "Adjust") {
        for (const part of ["Basic", "HSL", "Curves", "Color wheel", "LUT"]) {
          const b = inspector.getByRole("radio", { name: part, exact: true });
          if (await b.count()) {
            await b.click();
            await sliders(`${label} ${name} ${part}`);
          }
        }
      } else if (name === "Animation") {
        for (const slot of ["In", "Out", "Loop", "Combo"]) {
          const b = inspector.getByRole("radio", { name: slot, exact: true });
          if (!(await b.count())) continue;
          await b.click();
          // A preset, so the slot's sliders show; titles get a per-letter one.
          const tile = inspector.locator(".anim-tile", { hasText: label === "title" && slot === "In" ? "Letter rise" : /./ }).nth(label === "title" && slot === "In" ? 0 : 1);
          await tile.click();
          await page.waitForFunction(() => !window.videoEditor.state().playing, null, { timeout: 4000 }).catch(() => undefined);
          await sliders(`${label} ${name} ${slot}`);
        }
      } else await sliders(`${label} ${name}`);
    }
  };
  await visit(ids.video, "video");
  await visit(ids.text, "title");
  await visit(ids.audio, "sound");

  // The case from the launch film: Duration 1.2 to 2.0 s in one drag.
  await page.evaluate((id) => window.videoEditor.select([id]), ids.text);
  await tab("Animation");
  await inspector.getByRole("radio", { name: "In", exact: true }).click();
  await inspector.locator(".anim-tile", { hasText: "Fade" }).first().click();
  await page.waitForFunction(() => !window.videoEditor.state().playing, null, { timeout: 4000 }).catch(() => undefined);
  const dur = inspector.getByLabel("Animation duration");
  await dur.scrollIntoViewIfNeeded();
  const range = await dur.evaluate((e) => ({ min: +e.min, max: +e.max }));
  const b = await dur.boundingBox();
  const xAt = (s) => b.x + 8 + ((b.width - 16) * (s - range.min)) / (range.max - range.min);
  const before = await count();
  await page.mouse.move(xAt(1.2), b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(xAt(1.2 + i * 0.1), b.y + b.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(50);
  const filmCase = { steps: (await count()) - before, value: await dur.inputValue(), label: await page.evaluate(() => window.videoEditor.state().undoLabel) };
  filmCase.pass = filmCase.steps === 1 && filmCase.label === "In animation";

  // A held arrow key: its repeats are one step, and undo goes all the way back.
  const key = inspector.getByLabel("Animation duration");
  await key.focus();
  const k0 = await key.inputValue();
  const kBefore = await count();
  await page.keyboard.down("ArrowLeft");
  for (let i = 0; i < 4; i++) await page.keyboard.down("ArrowLeft"); // repeats
  await page.keyboard.up("ArrowLeft");
  const keySteps = (await count()) - kBefore;
  const k1 = await key.inputValue();
  const labels = await page.evaluate(() => window.__store.history().undo.slice(0, 3));
  await page.evaluate(() => window.videoEditor.action("undo"));
  const heldKey = { steps: keySteps, k0, k1, labels, undone: (await key.inputValue().catch(() => "gone")) === k0 };
  heldKey.pass = heldKey.steps === 1 && heldKey.undone;

  // A value set with no press (a script, assistive technology) is one step.
  await page.evaluate((id) => window.videoEditor.select([id]), ids.video);
  await tab("Video");
  const sBefore = await count();
  await inspector.getByRole("slider", { name: "Scale", exact: true }).fill("150");
  const scripted = { steps: (await count()) - sBefore, scale: await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).transform.scale, ids.video) };
  scripted.pass = scripted.steps === 1 && scripted.scale === 1.5;
  await page.evaluate((id) => window.videoEditor.select([id]), ids.text);

  // The color picker: live inputs while its square is dragged, then change.
  await tab("Text");
  await openAll();
  const color = inspector.locator('input[type="color"]').first();
  const cBefore = await count();
  await color.evaluate(async (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    el.focus();
    for (const c of ["#ff0000", "#ee2200", "#dd4400", "#cc6600", "#bb8800"]) {
      set.call(el, c);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const picker = { steps: (await count()) - cBefore };
  // The next pick after the picker closed is a step of its own.
  await color.evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, "#00ff00");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  picker.nextPick = (await count()) - cBefore;
  picker.pass = picker.steps === 1 && picker.nextPick === 2;

  // Track volume and pan, from the track header's menu.
  const head = page.locator(".tl-header").last();
  await head.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Track volume and pan/ }).click();
  const pop = page.locator(".tl-vol-pop");
  await pop.waitFor();
  for (const name of ["Track volume", "Track pan"]) await drag(pop.getByLabel(name, { exact: true }), "track");

  const bad = results.filter((r) => !r.pass);
  const details = {
    everySlider: { ok: results.length >= 25 && bad.length === 0, dragged: results.length, bad },
    filmCase: { ok: filmCase.pass, ...filmCase },
    heldKey: { ok: heldKey.pass, ...heldKey },
    colorPicker: { ok: picker.pass, ...picker },
    scripted: { ok: scripted.pass, ...scripted },
  };
  return { ok: Object.values(details).every((d) => d.ok), details, results };
};
