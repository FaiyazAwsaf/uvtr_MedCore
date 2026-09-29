import { expect, test } from "@playwright/test"

import { launchByUrl, launchFromPanel } from "./helpers"

/** J1 to J6 jump launchers (plan §10, P3.3). */

const ABDUL = "pat_abdul_karim"

test("J1 and J2 open the front desk and Abdul's booking with Dr. Kamal", async ({
  page,
}) => {
  await launchByUrl(page, "J1", "/?persona=per_ceo_anwar")
  await expect(page).toHaveURL(/\/reception$/)
  await expect(page.getByTestId("reception-search")).toBeVisible()

  await launchFromPanel(page, "J2")
  await expect(page).toHaveURL(/\/reception\/book/)
  await expect(
    page.locator('[data-testid="book-slot"][data-state="free"]').first()
  ).toBeVisible()
})

test("J5 has Abdul's paid CBC and CRP waiting for collection", async ({
  page,
}) => {
  await launchByUrl(page, "J5", "/?persona=per_ceo_anwar")
  await expect(page).toHaveURL(/\/lab$/)
  await expect(
    page.getByTestId("collect-row").filter({ hasText: "Abdul Karim" })
  ).toHaveCount(2)
})

test("J3 puts Abdul in Dr. Kamal's queue, and again without booking twice", async ({
  page,
}) => {
  await page.goto("/?persona=per_ceo_anwar")
  for (let run = 0; run < 2; run++) {
    await launchFromPanel(page, "J3")
    await expect(page).toHaveURL(/\/doctor$/)
    await expect(
      page.locator(`[data-testid="worklist-row"][data-patient-id="${ABDUL}"]`)
    ).toHaveCount(1)
  }
})

test("J4 opens Abdul's bill with the consult, tests, X-ray and medicines", async ({
  page,
}) => {
  await launchByUrl(page, "J4", "/?persona=per_ceo_anwar")
  await expect(
    page.locator(`[data-testid="cashier-patient"][data-patient-id="${ABDUL}"]`)
  ).toBeVisible()
  await expect(
    page.locator('[data-testid="basket-line"][data-source-type="rx-line"]')
  ).toHaveCount(2)
})

test("J6 opens the paid Rx for dispensing and the dispense commits", async ({
  page,
}) => {
  await launchByUrl(page, "J6", "/?persona=per_ceo_anwar")
  await expect(page).toHaveURL(/\/pharmacy\/dispense\/[^/]+$/)
  await expect(page.getByTestId("dispense-line")).toHaveCount(2)
  await page.getByTestId("dispense-verify").fill("3418")
  await expect(page.getByTestId("dispense-verified")).toBeVisible()
  await page.getByTestId("dispense-confirm").click()
  await expect(page.getByTestId("label-preview")).toHaveCount(2)
})
