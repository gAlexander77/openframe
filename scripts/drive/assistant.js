// The AI assistant (called Copilot until 2026-10-17): the title bar button
// opens a panel named "AI assistant", and no "Copilot" is left on screen.
async (page) => {
  await page.goto("http://localhost:1420");
  await page.click(".create-card");
  const button = page.locator(".assistant-btn");
  await button.waitFor();
  const label = (await button.innerText()).trim();
  await button.click();
  const panel = page.locator("aside.assistant");
  await panel.waitFor();
  const heading = (await panel.locator("header strong").innerText()).trim();
  const named = await panel.getAttribute("aria-label");
  const copilot = await page.evaluate(() => document.body.innerText.includes("Copilot"));
  await page.waitForTimeout(500);
  await page.screenshot({ path: "scratch/assistant.png" });
  return { ok: label === "AI assistant" && heading === "AI assistant" && named === "AI assistant" && !copilot, details: { label, heading, named, copilot } };
};
