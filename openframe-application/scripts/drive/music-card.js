// The Audio tab's Generate music card: pick a style and a length, preview
// it (it renders and plays, Stop stops it), then Add puts the score on an
// audio track at the playhead with bar and drop markers, as one undo step.
async (page) => {
  await page.waitForFunction(() => !!window.videoEditor);
  page.setDefaultTimeout(60000);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.getByRole("tab", { name: "Audio" }).click();
  const card = page.getByRole("region", { name: "Generate music" });
  await card.scrollIntoViewIfNeeded();
  const details = {};
  details.card = { ok: await card.isVisible() };
  await card.getByLabel("Style").selectOption({ label: "Lo-fi chill" });
  await card.getByLabel("Length (s)").fill("12");
  details.blurb = { ok: /Laid back/.test(await card.locator("small").innerText()) };
  await page.waitForTimeout(300);
  await page.screenshot({ path: "scripts/drive/shots/music-card.png", clip: (await card.boundingBox()) ?? undefined });

  await card.getByRole("button", { name: "Preview" }).click();
  await card.getByRole("progressbar").waitFor({ state: "attached" }).catch(() => {});
  await card.getByRole("button", { name: "Stop" }).waitFor();
  details.preview = { ok: /Previewing/.test(await card.locator(".music-status").innerText()), status: await card.locator(".music-status").innerText() };
  await card.getByRole("button", { name: "Stop" }).click();
  details.stopped = { ok: await card.getByRole("button", { name: "Preview" }).isVisible() };

  const before = await page.evaluate(() => window.videoEditor.describe());
  await card.getByRole("button", { name: "Add" }).click();
  await page.waitForFunction((n) => window.videoEditor.describe().tracks.flatMap((t) => t.clips).length > n, before.tracks.flatMap((t) => t.clips).length);
  const after = await page.evaluate(() => window.videoEditor.describe());
  const clip = after.tracks.flatMap((t) => t.clips.map((c) => ({ ...c, kind: t.kind }))).find((c) => !before.tracks.some((t) => t.clips.some((x) => x.id === c.id)));
  const asset = after.assets.find((a) => a.id === clip?.asset);
  details.added = { ok: clip?.kind === "audio" && Math.abs(clip.end - clip.start - 12) < 0.1 && /Lo-fi chill \d+ BPM/.test(asset?.name ?? ""), clip, asset: asset?.name };
  const labels = (after.markers ?? []).map((m) => m.label);
  details.markers = { ok: labels.filter((l) => l === "Bar").length >= 3 && labels.includes("Drop"), labels };
  details.status = { ok: /Added at 0\.0 s/.test(await card.locator(".music-status").innerText()), text: await card.locator(".music-status").innerText() };
  // One undo takes the clip and its markers away together.
  await page.evaluate(() => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "undo", arguments: {} } }));
  await page.waitForTimeout(300);
  const undone = await page.evaluate(() => window.videoEditor.describe());
  details.undo = { ok: !undone.tracks.some((t) => t.clips.some((c) => c.id === clip?.id)) && !(undone.markers ?? []).some((m) => m.label === "Bar") };
  return { ok: Object.values(details).every((d) => d.ok), details };
}
