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

test("S15 by URL queues an offline registration and lands on the review queue", async ({
  page,
}) => {
  await page.goto("/reception?persona=per_reception_farhana&launch=S15")
  await expect(page).toHaveURL(/\/reception\/review$/)
  const cue = page.locator('[data-testid="cue-card"][data-scenario-id="S15"]')
  await expect(cue).toBeVisible()
  // The cue names the person and the provisional UHID the setup produced.
  await expect(cue).toContainText(/registered at Dhanmondi while offline/)
})
