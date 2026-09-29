import { expect, test } from "@playwright/test"

import { launchByUrl, launchFromPanel } from "./helpers"

/** S2 and S4D launchers (plan §10, P3.3). */

test("S2 opens a fresh encounter where Zimax 500 is out and a transfer can be requested, twice", async ({
  page,
}) => {
  await page.goto("/?persona=per_doctor_kamal")
  for (let run = 0; run < 2; run++) {
    await launchFromPanel(page, "S2")
    await expect(page).toHaveURL(/\/doctor\/encounter\/[^/]+$/)
    await expect(page.getByTestId("encounter-page")).toBeVisible()

    await page.getByTestId("rx-search").fill("Zimax 500")
    await page
      .locator('[data-testid="rx-option"][data-brand-id="brd_zimax_500mg"]')
      .click()
    await expect(page.getByTestId("rx-stock-badge")).toHaveAttribute(
      "data-status",
      "other-branch"
    )
    await expect(
      page.locator(
        '[data-testid="rx-alternative"][data-brand-id="brd_azithrocin_500mg"]'
      )
    ).toBeVisible()
    await page
      .locator('[data-testid="rx-request-transfer"][data-branch="B3"]')
      .click()
    await expect(page.getByTestId("rx-transfer-requested")).toBeVisible()
  }
})

test("S4D opens Dr. Kamal's inbox with the doctor-side cue", async ({
  page,
}) => {
  await launchByUrl(page, "S4D", "/?persona=per_ceo_anwar")
  await expect(page).toHaveURL(/\/doctor\/inbox$/)
})
