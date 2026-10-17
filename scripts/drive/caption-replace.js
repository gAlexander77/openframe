// Caption Find and replace (CapCut's): three captions misspell a name; the
// Captions tab's card counts the whole-word matches (not the one inside a
// longer word), replaces them all as one undo step, and leaves non-caption
// titles alone. replace_caption_text does the same for agents.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    const api = window.videoEditor;
    api.exec("add_captions", {
      captions: [
        { start: 0, end: 1, text: "Jon is here." },
        { start: 1, end: 2, text: "Thanks, jon, and Jonathan too." },
        { start: 2, end: 3, text: "Bye." },
      ],
    });
    api.exec("add_text", { text: "Jon (title)", start: 0, duration: 3 });
  });
  const texts = () => page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).filter((c) => c.type === "text").map((c) => `${c.caption ? "C" : "T"}:${c.text}`).sort());
  const details = {};
  await page.getByRole("tab", { name: "Captions" }).click();
  await page.getByLabel("Find", { exact: true }).fill("jon");
  await page.getByLabel("Replace with", { exact: true }).fill("John");
  const button = page.getByRole("button", { name: /Replace 2 matches/ });
  details.count = { ok: (await button.count()) === 1 };
  await button.click();
  const after = await texts();
  details.replaced = {
    ok: JSON.stringify(after) === JSON.stringify(["C:Bye.", "C:John is here.", "C:Thanks, John, and Jonathan too.", "T:Jon (title)"]),
    after,
  };
  details.undo = { ok: (await page.getByRole("button", { name: 'Undo Replace "jon"', exact: true }).count()) === 1 };
  details.none = { ok: (await page.getByRole("button", { name: "No matches" }).count()) === 1 };
  await page.evaluate(() => window.videoEditor.exec("replace_caption_text", { find: "Bye", replace: "See you" }));
  details.command = { ok: (await texts()).includes("C:See you.") };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
