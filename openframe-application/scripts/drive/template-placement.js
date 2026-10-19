// Multi-layer templates land as one grouped block on rows of their own
// above the footage (ADR-073): the location tag found putting its title on
// the B-roll row and a second one making an extra track. Here a B-roll
// row holds a shot later on; two location tags (from the Text tab's path
// and from the agent's add_text_template) must never touch it, must
// share their rows, and group per template.
async (page) => {
  page.setDefaultTimeout(6000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const r = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const loaded = performance.getEntriesByType("resource").map((e) => e.name);
    const mod = (path) => import(loaded.find((n) => new URL(n).pathname === path) ?? path);
    const { store } = await mod("/src/state/store.ts");
    const { applyTemplate } = await mod("/src/state/apply.ts");
    const { createTrack } = await mod("/src/lib/project/defaults.ts");
    const ops = await mod("/src/lib/project/ops.ts");
    const [v] = await ve.import([{ name: "h264-aac.mkv", src: `${location.origin}/fixtures/media/h264-aac.mkv` }]);
    ve.exec("add_media_clip", { asset_id: v.id, start: 0, duration: 5 });
    ve.exec("add_media_clip", { asset_id: v.id, start: 5, duration: 5 });
    // A B-roll row above the main track, with a shot from 7 s.
    const broll = createTrack("video", "B-roll");
    store.edit("B-roll", (p) => ops.addTrack(p, broll, 0));
    ve.exec("add_media_clip", { asset_id: v.id, start: 7, duration: 2, track_id: broll.id });
    const before = ve.project().tracks.length;
    applyTemplate("location", 0);
    const first = store.get().selection;
    ve.exec("add_text_template", { name: "location", start: 4.5 });
    const tracks = ve.project().tracks;
    const all = tracks.flatMap((t) => t.clips.map((c) => ({ ...c, track: t.id, row: tracks.indexOf(t) })));
    const texts = all.filter((c) => c.type === "text");
    const brollRow = tracks.findIndex((t) => t.id === broll.id);
    return {
      before,
      after: tracks.length,
      brollClips: tracks[brollRow].clips.map((c) => c.type),
      rows: texts.map((c) => c.row),
      brollRow,
      groups: [...new Set(texts.map((c) => c.group))],
      firstGroup: [...new Set(first.map((id) => all.find((c) => c.id === id)?.group))],
      onBroll: !!broll.id && ve.project().tracks.find((t) => t.id === broll.id).clips.some((c) => c.type === "text"),
    };
  });
  const details = {
    neverOnBroll: { ok: !r.onBroll && r.brollClips.every((t) => t === "video"), brollClips: r.brollClips },
    aboveFootage: { ok: r.rows.every((row) => row < r.brollRow), rows: r.rows, brollRow: r.brollRow },
    twoRowsOnly: { ok: r.after === r.before + 2, before: r.before, after: r.after },
    groupedPerTemplate: { ok: r.groups.length === 2 && r.groups.every(Boolean) && r.firstGroup.length === 1, groups: r.groups.length },
  };
  await page.locator(".timeline-panel").screenshot({ path: "scratch/template-placement.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
