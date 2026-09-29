import { expect, test } from "@playwright/test"

import { launchFromPanel } from "./helpers"

/**
 * S14 and S15 launchers (plan §10, P3.3): each one's setup succeeds twice in a
 * row, the window switches persona and screen, and the cue card opens.
 */

test("S14 from the demo panel cuts B1 and opens the front desk with its cue card", async ({
  page,
}) => {
  await page.goto("/?persona=per_ceo_anwar")
  for (let run = 0; run < 2; run++) {
    await launchFromPanel(page, "S14")
    await expect(page).toHaveURL(/\/reception$/)
    await expect(
      page.locator('[data-testid="cue-card"][data-scenario-id="S14"]')
    ).toBeVisible()
    await expect(page.locator('[data-slot="offline-banner"]')).toBeVisible()
  }
})

test("S15 by URL: after reconnecting B1 the offline registration and its online variant reach review and are resolved", async ({
  page,
}) => {
  await page.goto("/reception?persona=per_reception_farhana&launch=S15")
  await expect(page).toHaveURL(/\/reception\/review$/)
  const cue = page.locator('[data-testid="cue-card"][data-scenario-id="S15"]')
  await expect(cue).toBeVisible()
  // The cue names the person and the provisional UHID the setup produced.
  await expect(cue).toContainText(/registered at Dhanmondi while offline/)

  // Reconnect B1 from the demo panel: the queued work replays and the pair
  // lands in the review queue, where the front desk decides.
  await page.getByTestId("demo-panel-trigger").click()
  await page.getByRole("tab", { name: "Clock and network" }).click()
  await page.getByTestId("network-reconnect-B1").click()
  await page.keyboard.press("Escape")
  const item = page
    .locator('[data-testid="review-item"][data-kind="sync-duplicate"]')
    .first()
  await expect(item).toBeVisible()
  await item
    .getByTestId("review-reason")
    .fill("Checked both ID cards: different people")
  await item.getByTestId("review-different").click()
  await page.getByText(/^Resolved \(/).click()
  await expect(page.getByTestId("review-resolved").first()).toHaveAttribute(
    "data-resolution",
    "different"
  )
})
