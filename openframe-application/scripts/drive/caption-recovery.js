// Inject a worker load failure and a stalled load; both must recover for retry.
async (page) => {
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: "speech-test.wav", src: `${location.origin}/fixtures/media/speech-test.wav` }]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0 });
  });
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await page.locator(".cap-field select").nth(1).selectOption("onnx-community/whisper-tiny.en_timestamped");
  const details = {};
  const recovered = async () => {
    try { await page.locator(".cap-go").waitFor({ timeout: 5000 }); return true; }
    catch { return false; }
  };
  await page.route("**/asr.worker.ts*", (route) => route.abort());
  await page.locator(".cap-go").click();
  const failedCleanly = await recovered();
  const messages = await page.locator(".toast").allTextContents();
  details.loadFailure = { ok: failedCleanly && messages.some((m) => /Captions failed:/.test(m)), messages };
  await page.unroute("**/asr.worker.ts*");
  if (!failedCleanly) return { ok: false, details };

  let held;
  await page.route("**/asr.worker.ts*", (route) => { held = route; });
  const loading = page.waitForRequest("**/asr.worker.ts*");
  await page.locator(".cap-go").click();
  await loading;
  // The panel's own Cancel: the progress toast has one too (ADR-142).
  await page.locator(".cap-progress").getByRole("button", { name: "Cancel", exact: true }).click();
  details.cancel = { ok: await recovered() };
  await held?.abort().catch(() => {});
  await page.unroute("**/asr.worker.ts*");
  if (!details.cancel.ok) return { ok: false, details };

  const started = Date.now();
  await page.locator(".cap-go").click();
  await page.locator(".cap-progress").waitFor();
  await page.locator(".cap-go").waitFor({ timeout: 300000 });
  const captions = await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).filter((c) => c.caption).map((c) => c.text));
  details.retry = { ok: captions.length > 0, captions, elapsedMs: Date.now() - started };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
