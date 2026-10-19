// Home's Recently deleted (ADR-078): Delete moves a project there at once,
// with Undo on the toast; Restore puts it back; Delete forever asks twice.
// A trashed project is not offered to agents (list_projects,
// open_project). Expiry after 30 days is unit-tested (projectTrash.test.ts).
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("set_project", { name: "Trash drive" });
    v.exec("add_color_clip", { color: "#336699", start: 0, duration: 3 });
  });
  await page.waitForFunction(() => document.querySelector(".save-state")?.textContent?.startsWith("Saved"));
  await page.locator(".menubar-item > button", { hasText: "File" }).click();
  await page.getByRole("menuitem", { name: "Back to home" }).click();
  const card = page.locator(".project-card", { has: page.locator(".project-card-name", { hasText: /^Trash drive$/ }) });
  await card.waitFor();
  const details = {};
  const mcp = (name, args = {}) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const listed = async () => JSON.parse((await mcp("list_projects")).result.content[0].text);
  const names = async () => (await listed()).map((p) => p.name ?? p).join("|");

  // Delete: gone at once, Undo on the toast brings it back.
  await card.hover();
  await page.getByRole("button", { name: "Delete Trash drive", exact: true }).click();
  const undo = page.locator(".toast", { hasText: "Moved “Trash drive” to Recently deleted" }).locator(".toast-action", { hasText: "Undo" });
  await undo.waitFor();
  await card.waitFor({ state: "detached" });
  details.trashed = { ok: (await page.locator(".home-trash").count()) === 1 };
  await page.locator(".toasts").screenshot({ path: "scratch/project-trash-toast.png" });
  await undo.click();
  await card.waitFor();
  details.undo = { ok: (await page.locator(".home-trash").count()) === 0 };

  // Delete again: it waits in Recently deleted, hidden from agents.
  await card.hover();
  await page.getByRole("button", { name: "Delete Trash drive", exact: true }).click();
  await card.waitFor({ state: "detached" });
  await page.locator(".home-trash summary").click();
  const row = page.locator(".trash-row", { hasText: "Trash drive" });
  details.row = { ok: (await row.innerText()).includes("Deleted for good in 30 days"), text: await row.innerText() };
  details.agentsSkip = { ok: !(await names()).includes("Trash drive"), names: await names() };
  const opened = await mcp("open_project", { project: "Trash drive" });
  details.agentsCannotOpen = { ok: opened.result?.isError === true };
  await page.screenshot({ path: "scratch/project-trash.png" });

  // Restore puts it back where it was.
  await page.getByRole("button", { name: "Restore Trash drive", exact: true }).click();
  await card.waitFor();
  details.restored = { ok: (await page.locator(".home-trash").count()) === 0 && (await names()).includes("Trash drive") };

  // Delete forever: the first click arms, the second deletes.
  await card.hover();
  await page.getByRole("button", { name: "Delete Trash drive", exact: true }).click();
  await card.waitFor({ state: "detached" });
  await page.locator(".home-trash summary").click();
  await page.getByRole("button", { name: "Delete Trash drive forever", exact: true }).click();
  details.armed = { ok: (await page.getByRole("button", { name: "Confirm delete Trash drive forever", exact: true }).count()) === 1 };
  await page.getByRole("button", { name: "Confirm delete Trash drive forever", exact: true }).click();
  await row.waitFor({ state: "detached" });
  details.gone = { ok: (await page.locator(".home-trash").count()) === 0 && !(await names()).includes("Trash drive") };

  // The opened project still opens (the trash did not touch other files).
  return { ok: Object.values(details).every((d) => d.ok), details };
};
