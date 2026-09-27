import { expect, test, type Page } from "@playwright/test"

/**
 * Checkpoint 1, items 5 and 7: the demo clock is shared by every window, and
 * a demo reset restores the seed and reloads every window.
 */

async function openClock(page: Page) {
  if (!(await page.getByTestId("demo-panel").isVisible())) {
    await page.getByTestId("demo-panel-trigger").click()
  }
  await page.getByRole("tab", { name: "Clock and network" }).click()
  await expect(page.getByTestId("demo-clock")).toBeVisible()
}

test("fast-forward in one window moves the clock in another, and reset restores real time everywhere", async ({
  context,
}) => {
  const a = await context.newPage()
  const b = await context.newPage()
  await a.goto("/?persona=per_ceo_anwar")
  await b.goto("/?persona=per_reception_farhana")
  await openClock(a)
  await openClock(b)
  await expect(b.getByTestId("demo-clock")).toContainText("Running at real time")

  await a.getByTestId("demo-clock").getByRole("button", { name: "+1h" }).click()
  await expect(a.getByTestId("demo-clock")).toContainText("1h ahead of real time")
  await expect(b.getByTestId("demo-clock")).toContainText("1h ahead of real time")

  // Reset from A: every window reloads onto freshly seeded data at real time.
  await a.getByRole("tab", { name: "Data" }).click()
  const panel = a.getByTestId("demo-panel")
  await panel.getByTestId("demo-reset").click()
  const reloaded = b.waitForEvent("framenavigated")
  await panel.getByTestId("demo-reset-confirm").click()
  await reloaded
  await openClock(b)
  await expect(b.getByTestId("demo-clock")).toContainText("Running at real time")
})
