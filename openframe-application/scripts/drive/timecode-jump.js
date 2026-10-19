// Go to a typed time (Premiere's Playhead Position): click the player's
// current timecode, type, Enter. 1000 is ten seconds (digits fill the
// groups from the right), +15 moves fifteen frames, Escape keeps the
// playhead, and something that is not a time says so.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => window.videoEditor.exec("add_color_clip", { color: "#336699", start: 0, duration: 20 }));
  const playhead = () => page.evaluate(() => window.videoEditor.state().playhead);
  const button = page.getByRole("button", { name: "Go to timecode" });
  const field = page.getByRole("textbox", { name: "Go to timecode" });
  const type = async (text, key = "Enter") => {
    await button.click();
    await field.fill(text);
    await page.screenshot({ path: "__REPO__/scratch/timecode-jump.png" });
    await field.press(key);
  };
  const details = {};
  await type("1000");
  details.digits = { ok: (await playhead()) === 300, at: await playhead() };
  await type("+15");
  details.offset = { ok: (await playhead()) === 315, at: await playhead() };
  await type("00:00:02:00", "Escape");
  details.escape = { ok: (await playhead()) === 315 && (await button.count()) === 1 };
  await type("soon");
  details.refused = { ok: (await playhead()) === 315 && (await page.locator(".toast", { hasText: "is not a timecode" }).count()) === 1 };
  // Typing does not trigger the editor's keys (S would split, Space play).
  await button.click();
  await field.fill("");
  await field.pressSequentially("5s ");
  details.noKeys = { ok: (await page.evaluate(() => window.videoEditor.state().playing)) === false && (await page.evaluate(() => window.videoEditor.project().tracks[0].clips.length)) === 1 };
  await field.press("Escape");
  return { ok: Object.values(details).every((d) => d.ok), details };
};
