// Export presets and the canvas shape (ADR-073): settings remembered from
// a 9:16 export no longer show a 16:9 project as "TikTok, Reels and
// Shorts"; picking that preset on 16:9 says what it will export and offers
// to make the canvas 9:16, which only that click does (one undo step).
// Also: choosing Custom never throws; a codec the device cannot encode is
// named when it is swapped; In to Out, disabled, says why in plain sight.
async (page) => {
  page.setDefaultTimeout(6000);
  await page.setViewportSize({ width: 1600, height: 950 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  // What one export with the social preset leaves behind.
  await page.evaluate(() => localStorage.setItem("export.settings", JSON.stringify({ video: true, format: "mp4", codec: "avc", resolution: "1080p", quality: "higher", audio: true })));
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => window.videoEditor.exec("add_color_clip", { color: "#336699", start: 0, duration: 2 }));
  const open = async () => {
    await page.getByRole("button", { name: "Export", exact: true }).first().click();
    await page.locator("#export-preset").waitFor();
  };
  const preset = page.locator("#export-preset");
  const note = page.locator(".export-shape-note");
  const details = {};
  await open();
  details.notPreselected = { ok: (await preset.inputValue()) !== "social", preset: await preset.inputValue() };

  await preset.selectOption("social");
  await note.first().waitFor();
  const text = await note.first().innerText();
  details.saysWhat = { ok: (await preset.inputValue()) === "social" && /Made for 9:16 video/.test(text) && /1920×1080/.test(text), text };
  await page.waitForTimeout(300);
  await page.locator(".export-dialog").screenshot({ path: "scratch/export-shape.png" });
  await note.getByRole("button", { name: "Make the canvas 9:16" }).click();
  const canvas = await page.evaluate(() => ({ w: window.videoEditor.project().width, h: window.videoEditor.project().height, undo: window.videoEditor.state().undoLabel }));
  details.reshapedOnClick = { ok: canvas.w === 1080 && canvas.h === 1920 && canvas.undo === "Canvas size" && (await note.count()) === 0, ...canvas };

  // Custom, chosen when it is offered, keeps the settings and throws nothing.
  await page.locator("#export-res").selectOption("720p");
  const offered = (await preset.locator('option[value=""]').count()) === 1;
  await preset.selectOption("");
  details.customNoThrow = { ok: offered && (await preset.inputValue()) === "" && !errors.length, errors };

  // The HEVC master on a device without HEVC: Custom, with the reason.
  await preset.selectOption("master");
  await page.waitForTimeout(1500);
  const after = await preset.inputValue();
  const swapNote = await page.locator(".export-shape-note", { hasText: "can't be encoded" }).count();
  details.codecSwapSaid = { ok: after === "master" || swapNote === 1, hevcHere: after === "master", preset: after };

  // In to Out with no marks: disabled, and the reason shows.
  const inout = page.getByRole("radio", { name: "In to Out" });
  const hint = page.locator("#export-range-hint");
  details.inOutHint = {
    ok: (await inout.isDisabled()) && (await hint.isVisible()) && (await inout.getAttribute("aria-describedby")) === "export-range-hint" && (await inout.evaluate((e) => +getComputedStyle(e).opacity)) < 1,
    hint: await hint.innerText(),
  };
  await page.keyboard.press("Escape");
  return { ok: Object.values(details).every((d) => d.ok), details };
};
