// Real footage with fixture speech, then the same clip builder and measured
// checker an MCP client uses. Requires ffmpeg and the standard media fixtures.
async (page) => {
  const fs = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const dir = "__REPO__/scratch/clip-template";
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-stream_loop", "-1", "-i", "__REPO__/fixtures/media/green-screen.mp4", "-i", "__REPO__/fixtures/media/speech-test.wav", "-map", "0:v:0", "-map", "1:a:0", "-t", "10", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", `${dir}/talking.mp4`], { timeout: 120000 });
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  const call = (name, args = {}) => page.evaluate(async ([name, args]) => {
    const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    if (r.result?.isError || r.error) throw new Error(`${name}: ${JSON.stringify(r)}`);
    return JSON.parse(r.result.content[0].text);
  }, [name, args]);
  const origin = await page.evaluate(() => location.origin);
  const [a] = await call("import_media", { files: [{ src: `${origin}/scratch/clip-template/talking.mp4`, name: "Talking VOD" }] });
  const original = await page.evaluate(() => JSON.stringify(window.videoEditor.project()));
  const details = {};
  const projects = [];
  const credit = { name: "Fixture streamer", handle: "@fixture", platform: "twitch" };
  for (const layout of ["stream", "vertical_fill", "full"]) {
    const result = await call("create_clips", { asset_id: a.id, clips: [{ start: 0, end: 10, title: "Watch this" }], template: { layout, ...(layout === "stream" ? { facecam: { x: 0, y: 0, w: 0.3, h: 0.35 }, split: 0.35 } : {}), credit } });
    const made = result.projects[0];
    const forbidden = f => f.level !== "tip" && /contrast|app_buttons|caption.*fast|reading/.test(f.rule);
    details[`${layout}Creation`] = { ok: made.captions > 0 && Array.isArray(made.findings) && !made.findings.some(f => forbidden(f) || f.rule === "hook_no_clear_room"), made };
    projects.push({ layout, made });
  }
  details.original = { ok: await page.evaluate(json => JSON.stringify(window.videoEditor.project()) === json, original) };
  for (const { layout, made } of projects) {
    await call("open_project", { project: made.id });
    const checked = await call("check_project", { kind: "social_short" });
    const bad = checked.findings.filter(f => f.level !== "tip" && /contrast|app_buttons|caption.*fast|reading/.test(f.rule));
    details[`${layout}Check`] = { ok: bad.length === 0 && checked.summary.captions > 0 && !!checked.contrast && checked.contrast.lowest.every(t => t.ratio >= 4.5), bad, checked };
    // Import the app's actual geometry module through Vite, with the same
    // module URL as the app: no duplicated store or estimated text boxes.
    const geometry = await page.evaluate(async ({ layout, id, notes }) => {
      const mod = path => import(performance.getEntriesByType("resource").map(e => e.name).findLast(n => new URL(n).pathname === path) || path);
      const { seenTexts, seenLetters } = await mod("/src/lib/designCheck.ts");
      const { layerBox } = await mod("/src/lib/align.ts");
      const { layerAt } = await mod("/src/lib/render/plan.ts");
      const { safeArea } = await mod("/src/lib/ads.ts");
      const { clipSubjects } = await mod("/src/lib/clipTemplate.ts");
      const p = window.videoEditor.project();
      const texts = seenTexts(p);
      const hook = texts.find(s => s.c.text === "Watch this");
      const face = p.tracks.flatMap(t => t.clips).find(c => c.streamLayout === "facecam");
      const letters = hook && seenLetters(p, hook);
      const hb = letters?.box || null;
      const fb = face && layerBox(p, face, layerAt(p, face, 30)) || null;
      const s = safeArea(p);
      const safe = { left: s.left * p.width, right: (1 - s.right) * p.width, top: s.top * p.height, bottom: (1 - s.bottom) * p.height };
      const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      let subjects = [];
      if (layout !== "stream" && hook) {
        const { lookAtShots } = await mod("/src/state/subjects.ts");
        const shot = p.tracks.flatMap(t => t.clips).find(c => c.type === "video");
        if (shot) {
          const looks = await lookAtShots(p, undefined, [{ ...shot, duration: hook.duration }]);
          subjects = clipSubjects(p, shot, looks[shot.id]);
        }
      }
      const collisions = hb && hook ? texts.filter(t => t.c.id !== hook.c.id && t.start < hook.start + hook.duration && hook.start < t.start + t.duration).filter(t => {
        const b = seenLetters(p, t)?.box;
        return b && overlap(hb, b);
      }).map(t => t.c.text) : [];
      const inside = hb && hb.left >= safe.left - 0.5 && hb.right <= safe.right + 0.5 && hb.top >= safe.top - 0.5 && hb.bottom <= safe.bottom + 0.5;
      const subjectClear = subjects.length ? !!hb && subjects.every(b => !overlap(hb, b)) : notes.some(n => n.startsWith("No distinct subject found for the hook;"));
      return { ok: p.id === id && !!hb && letters.opacity > 0 && inside && collisions.length === 0 && (layout === "stream" ? !!fb && hb.top >= fb.cy + fb.hh - 0.5 : subjectClear), project: p.id, hook: hb, facecam: fb, safe, subjects, collisions,
        texts: p.tracks.flatMap(t => t.clips).filter(c => c.type === "text").map(c => ({ text: c.text, disabled: !!c.disabled })) };
    }, { layout, id: made.id, notes: made.notes });
    details[`${layout}Geometry`] = geometry;
  }
  const imports = await call("import_media", { files: [{ src: `${origin}/fixtures/media/speech-test.wav`, name: "Unknown excerpt" }, { src: `${origin}/fixtures/media/music-30s.mp3`, name: "Unknown bed" }] });
  details.audioImports = { ok: imports[0].role === "dialog" && imports[1].role === "music" && imports.every(a => a.audio_role?.reason), imports };
  for (const [i, a] of imports.entries()) {
    await call("add_media_clip", { asset_id: a.id, start: 0 });
    const role = await page.evaluate(id => {
      const p = window.videoEditor.project();
      return p.tracks.find(t => t.clips.some(c => c.assetId === id))?.role;
    }, a.id);
    details[`audioPlacement${i}`] = { ok: role === ["dialog", "music"][i], role };
  }
  return { ok: Object.values(details).every(d => d.ok), details };
}
