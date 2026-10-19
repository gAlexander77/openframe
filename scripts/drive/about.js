// Help > About opens a dialog (it used to be a toast): name, version, the
// GPL-3.0-only license with a link, the repository and user guide links,
// and credits read from the manifests at build time. On Home and in the
// editor alike. The web build opens links in a new tab (stubbed here).
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.evaluate(() => {
    window.__opened = [];
    window.open = (url) => (window.__opened.push(url), null);
  });
  const details = {};
  const openAbout = async () => {
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await page.getByRole("menuitem", { name: /^About OpenFrame/ }).click();
    return page.locator("dialog.about-dialog");
  };

  // On Home.
  let dialog = await openAbout();
  await dialog.waitFor();
  const text = await dialog.innerText();
  const version = await page.evaluate(() => document.querySelector(".about-version")?.textContent ?? "");
  details.version = { ok: /Version \d+\.\d+\.\d+/.test(version), version };
  details.license = { ok: text.includes("GPL-3.0-only") && text.includes("GNU General Public License"), };
  const rows = await dialog.locator(".about-credits tr").allInnerTexts();
  const has = (name) => rows.some((r) => r.startsWith(name + "\t") || r.startsWith(name + " "));
  details.credits = { ok: ["mediabunny", "react", "lucide-react", "tauri", "serde"].every(has) && rows.length >= 10, rows: rows.length, sample: rows.slice(0, 3) };
  details.licenses = { ok: rows.some((r) => /mediabunny.*MPL-2\.0/.test(r)) && rows.some((r) => /react\s.*MIT/.test(r)), };
  await dialog.screenshot({ path: "scratch/about.png" });
  await dialog.getByRole("button", { name: /Read the license/ }).click();
  await dialog.getByRole("button", { name: /Source code/ }).click();
  await dialog.getByRole("button", { name: /User guide/ }).click();
  await dialog.getByRole("button", { name: /Third-party licenses/ }).click();
  const opened = await page.evaluate(() => window.__opened);
  details.links = {
    ok: opened.length === 4 && opened[0] === "https://www.gnu.org/licenses/gpl-3.0.html" && opened[1] === "https://github.com/gAlexander77/openframe" && opened[2].endsWith("/docs/User%20guide.md") && opened[3].endsWith("/docs/Third-party%20licenses.md"),
    opened,
  };
  await page.keyboard.press("Escape");
  details.closes = { ok: (await page.locator("dialog.about-dialog").count()) === 0 };

  // In the editor too, closed by its button.
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  dialog = await openAbout();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  details.editor = { ok: (await page.locator("dialog.about-dialog").count()) === 0 };
  details.noToast = { ok: (await page.locator(".toast").filter({ hasText: /OpenFrame v/ }).count()) === 0 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
