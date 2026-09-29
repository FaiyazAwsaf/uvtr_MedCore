import { expect, type Page } from "@playwright/test"

/**
 * Launch a scenario from the demo panel's Scenarios tab, the way the
 * presenter does, and wait until the window has moved to the scenario.
 */
export async function launchFromPanel(
  page: Page,
  scenarioId: string
): Promise<void> {
  if (!(await page.getByTestId("demo-panel").isVisible())) {
    await page.getByTestId("demo-panel-trigger").click()
  }
  await page.getByRole("tab", { name: "Scenarios" }).click()
  const button = page.locator(
    `[data-testid="scenario-launch"][data-scenario-id="${scenarioId}"]`
  )
  await button.click()
  await expect(page.getByTestId("demo-panel")).toBeHidden()
  await expect(
    page.locator(`[data-testid="cue-card"][data-scenario-id="${scenarioId}"]`)
  ).toBeVisible()
}

/**
 * Launch a scenario by address (`?launch=<id>`), as bookmarks and the
 * 4-window opener do, and wait for its cue card.
 */
export async function launchByUrl(
  page: Page,
  scenarioId: string,
  from = "/"
): Promise<void> {
  const joiner = from.includes("?") ? "&" : "?"
  await page.goto(`${from}${joiner}launch=${scenarioId}`)
  await expect(
    page.locator(`[data-testid="cue-card"][data-scenario-id="${scenarioId}"]`)
  ).toBeVisible()
}
