// Speed ramp on the beat: set_speed_ramp (through window.videoEditor.mcp)
// puts a clip's slow moment exactly on a beat while the clip keeps its
// place and length, so the cut after it stays on the beat too. The
// framecode fixture shows its own frame number in blocks, so the viewer
// proves what plays: about two source frames a timeline frame before the
// ramp, about 0.3 on the beat, and every frame the one the time map says.
async (page) => {
  page.setDefaultTimeout(15000);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const call = (name, args = {}) =>
    page.evaluate(async ([name, args]) => {
      const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      const c = r.result?.content?.[0];
      if (r.error || r.result.isError) throw new Error(`${name}: ${r.error?.message ?? c.text}`);
      return c.type === "text" ? JSON.parse(c.text) : c;
    }, [name, args]);
  const origin = new URL(page.url()).origin;
  const [code] = await call("import_media", { files: [{ src: `${origin}/fixtures/media/framecode-30.mp4`, name: "framecode-30.mp4" }] });
  const a = (await call("add_media_clip", { asset_id: code.id, start: 0, duration: 2, in: 1 })).added_clips[0];
  const b = (await call("add_media_clip", { asset_id: code.id, start: 2, duration: 1, in: 7 })).added_clips[0];
  const details = {};
  const ramp = await call("set_speed_ramp", { clip_id: a.id, at: 1.0 });
  const after = ramp.changed_clips.find((c) => c.id === a.id);
  details.keepsPlace = { ok: after.start === 0 && after.end === 2 && after.speed_curve === "custom" && (await call("describe_project")).tracks.find((t) => t.main).clips[1].start === 2, clip: after };

  const shown = await page.evaluate(async (id) => {
    const ve = window.videoEditor;
    const loaded = performance.getEntriesByType("resource").map((e) => e.name);
    const mod = (path) => import(loaded.find((n) => new URL(n).pathname === path) ?? path);
    const ops = await mod("/src/lib/project/ops.ts");
    const p = ve.project();
    const c = ops.findClip(p, id).clip;
    const read = () => {
      const { width: w, height: h, data } = ve.pixels();
      let n = 0;
      for (let i = 0; i < 10; i++) if (data[(Math.floor(h / 2) * w + Math.floor(((i + 0.5) * w) / 10)) * 4] > 128) n |= 1 << i;
      return n;
    };
    const out = [];
    for (let f = 0; f < 60; f++) {
      ve.seek(f);
      await new Promise((r) => setTimeout(r, 20));
      await ve.rendered();
      out.push({ f, got: read(), want: Math.floor((ops.sourceTimeAt(c, f, p.fps) + 0.25 / 30) * 30) });
    }
    return out;
  }, a.id);
  const bad = shown.filter((s) => s.got !== s.want);
  details.everyFrame = { ok: bad.length === 0, bad: bad.slice(0, 8) };
  // Source frames per timeline frame: fast going in, slow on the beat (frame 30).
  const rate = (from, to) => (shown[to].got - shown[from].got) / (to - from);
  details.shape = { ok: rate(0, 20) > 1.6 && rate(30, 37) < 0.5, before: rate(0, 20), onBeat: rate(30, 37), atBeat: shown[30].got };
  // A preset, its slowest point moved onto the beat.
  const bullet = await call("set_speed_ramp", { clip_id: b.id, preset: "bullet", at: 2.5 });
  details.preset = { ok: bullet.changed_clips[0].speed_curve === "bullet" && bullet.changed_clips[0].start === 2 && bullet.changed_clips[0].end === 3 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
