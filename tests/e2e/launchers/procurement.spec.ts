import { expect, test } from "@playwright/test"

import { launchFromPanel } from "./helpers"

/** S12 partial goods receipt (plan §10, objective §3D). */

/** A day `days` from today, as a date input takes it (the demo clock is not moved here). */
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

const NAPA_ALERT = '[data-testid="low-stock-row"][data-brand-id="brd_napa_500mg"]'

test("S12: receive 85 with 5 short-dated into quarantine, 80 received · 20 pending, invoice matched, twice", async ({
  context,
  page,
}) => {
  // A second window on the store shows the Napa alert clearing live.
  const store = await context.newPage()
  await store.goto("/store?persona=per_store_habibur")
  await expect(store.getByTestId("store-screen")).toBeVisible()

  await page.goto("/?persona=per_store_habibur")
  for (let run = 0; run < 2; run++) {
    await launchFromPanel(page, "S12")
    await expect(page).toHaveURL(/\/store\/grn\?po=/)
    const form = page.getByTestId("grn-form")
    await expect(form).toBeVisible()
    await expect(form).toHaveAttribute("data-po-no", run === 0 ? "PO-1042" : "PO-1043")
    await expect(store.locator(NAPA_ALERT)).toHaveCount(1)

    await page.getByTestId("grn-batch").nth(0).fill(`NP${run}A`)
    await page.getByTestId("grn-expiry").nth(0).fill(isoIn(730))
    await page.getByTestId("grn-received").nth(0).fill("80")
    await page.getByTestId("grn-add-lot").click()
    await page.getByTestId("grn-batch").nth(1).fill(`NP${run}S`)
    await page.getByTestId("grn-received").nth(1).fill("5")
    await page.getByTestId("grn-expiry").nth(1).fill(isoIn(60))
    // The short-dated lot is proposed for refusal as short expiry, held in quarantine.
    await expect(page.getByTestId("grn-rejected").nth(1)).toHaveValue("5")
    await expect(page.getByTestId("grn-reason").nth(1)).toHaveValue("short-expiry")
    await expect(page.getByTestId("grn-quarantine").nth(1)).toHaveAttribute("aria-checked", "true")
    await page.getByTestId("grn-post").click()

    await expect(page.getByTestId("grn-done")).toBeVisible()
    await expect(page.getByTestId("grn-summary")).toHaveText("80 received · 20 pending")
    await expect(store.locator(NAPA_ALERT)).toHaveCount(0)

    await page.getByTestId("vi-open").click()
    await page.getByTestId("vi-ref").fill(`BX-INV-5512${run}`)
    await expect(page.getByTestId("vi-qty").first()).toHaveValue("80")
    await page.getByTestId("vi-save").click()
    await expect(page.getByTestId("vi-result")).toHaveAttribute("data-status", "matched")
    await page.getByTestId("vi-close").click()
  }
})
