import { expect, test, type Page } from "@playwright/test"

import { launchByUrl, launchFromPanel } from "./helpers"

/**
 * S9, S10 and S13 launchers (plan §10, P3.3): each launches twice in a row,
 * lands on its screen with the cue card, and the presenter's key action
 * commits every time.
 */

/** The inline supervisor override: Nasrin is the first approver at B1; PIN 1234 (simulated). */
async function approve(page: Page, reason = "Checked at the counter") {
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.locator("#override-pin") })
  await expect(dialog).toBeVisible()
  await dialog.locator("#override-reason").fill(reason)
  await dialog.locator("#override-pin").fill("1234")
  await dialog.getByRole("button", { name: "Approve", exact: true }).click()
}

/** Waits for the window to leave `before` and returns the new address. */
async function nextUrl(page: Page, before: string): Promise<URL> {
  await expect.poll(() => page.url(), { timeout: 30_000 }).not.toBe(before)
  return new URL(page.url())
}

async function closeDone(page: Page) {
  await expect(page.getByTestId("refund-done")).toBeVisible()
  await page.getByTestId("refund-close").click()
  await expect(page.getByTestId("refund-dialog")).toBeHidden()
}

test("S9 from the demo panel: cancel by stage, auto, approved, blocked then goodwill, twice", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/cashier?persona=per_cashier_rafiq")
  for (let run = 0; run < 2; run++) {
    const before = page.url()
    await launchFromPanel(page, "S9")
    const url = await nextUrl(page, before)
    expect(url.pathname).toBe("/cashier/refunds")
    expect(url.searchParams.get("patient")).toBe("pat_nasima_khatun")
    await expect(
      page.locator('[data-testid="cue-card"][data-scenario-id="S9"]')
    ).toBeVisible()
    const invoice = page.locator(
      `[data-testid="refund-invoice"][data-invoice-id="${url.searchParams.get("focus")}"]`
    )
    await expect(invoice).toHaveAttribute("data-status", "paid")
    const line = (stage: string) =>
      invoice.locator(`[data-testid="refund-line"][data-stage="${stage}"]`)

    // Lipid profile, not collected: cancelled and refunded at once to bKash and cash.
    await line("lab-awaiting").getByTestId("cancel-line").click()
    await page.getByTestId("cancel-reason").fill("Patient declined the test")
    await page.getByTestId("cancel-confirm").click()
    await expect(page.getByTestId("credit-note-no")).toHaveText(
      /^CN-C1-\d{4}-\d{6}$/
    )
    await expect(
      page.locator('[data-testid="refund-tender"][data-tender="bkash"]')
    ).toContainText(/BKR/)
    await expect(
      page.locator('[data-testid="refund-tender"][data-tender="cash"]')
    ).toBeVisible()
    await closeDone(page)

    // HbA1c, collected: the supervisor approves the cancellation.
    await line("lab-collected").getByTestId("cancel-line").click()
    await page.getByTestId("cancel-reason").fill("Ordered twice")
    await page.getByTestId("refund-approve").click()
    await approve(page)
    await closeDone(page)

    // CBC, validated: blocked (and audited), then a goodwill refund with approval.
    await line("lab-validated").getByTestId("cancel-line").click()
    await page.getByTestId("cancel-reason").fill("Complaint about the wait")
    await page.getByTestId("cancel-confirm").click()
    await expect(
      page.locator(
        '[data-testid="refund-problem"][data-code="CANCEL_AFTER_VALIDATION"]'
      )
    ).toBeVisible()
    await page.getByTestId("refund-goodwill").click()
    await page.getByTestId("refund-approve").click()
    await approve(page)
    await closeDone(page)

    await expect(invoice).toHaveAttribute("data-status", "refunded")
    await expect(line("lab-validated")).toHaveCount(0)
    await expect(
      invoice.locator('[data-testid="refund-line"][data-stage="line-refunded"]')
    ).toHaveCount(1)
  }
})

test("S10 by URL: the approved refund goes back to bKash with a credit note and a fee-share reversal, twice", async ({
  page,
}) => {
  test.setTimeout(120_000)
  for (let run = 0; run < 2; run++) {
    await launchByUrl(page, "S10", "/cashier?persona=per_cashier_rafiq")
    await expect(page).toHaveURL(/\/cashier\/refunds\?invoice=/)
    const usg = page.locator(
      '[data-testid="refund-line"][data-stage="imaging-pending"]'
    )
    await expect(usg).toHaveCount(1)
    await usg.getByTestId("cancel-line").click()
    await page.getByTestId("cancel-reason").fill("Patient is travelling")
    await page.getByTestId("refund-approve").click()
    await approve(page)
    await expect(page.getByTestId("credit-note-no")).toHaveText(
      /^CN-C1-\d{4}-\d{6}$/
    )
    const bkash = page.locator(
      '[data-testid="refund-tender"][data-tender="bkash"]'
    )
    await expect(bkash).toContainText(/BKR[A-Z0-9]{8}/)
    await expect(bkash.locator('[data-slot="simulated-badge"]')).toBeVisible()
    await expect(
      page.locator(
        '[data-testid="refund-done"] [data-testid="fee-share-reversal"]'
      )
    ).toBeVisible()
    await closeDone(page)
    await expect(page.getByTestId("invoice-fee-share-reversal")).toBeVisible()
    await expect(
      page.locator('[data-testid="refund-line"][data-stage="line-cancelled"]')
    ).toHaveCount(1)
  }
})

test("S13: count ৳47,100 against ৳48,350, approve the variance, the shift locks, open a new one, twice", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/cashier?persona=per_cashier_rafiq")
  for (let run = 0; run < 2; run++) {
    const before = page.url()
    await launchFromPanel(page, "S13")
    const url = await nextUrl(page, before)
    expect(url.pathname).toBe("/cashier/shift")
    await expect(
      page.locator('[data-testid="cue-card"][data-scenario-id="S13"]')
    ).toBeVisible()
    await expect(page.getByTestId("shift-expected")).toHaveAttribute(
      "data-expected",
      "4835000"
    )

    const count = { "1000": "40", "500": "10", "100": "20", "50": "2" }
    for (const [value, n] of Object.entries(count)) {
      await page
        .locator(`[data-testid="shift-count"][data-denomination="${value}"]`)
        .fill(n)
    }
    await expect(page.getByTestId("shift-counted")).toHaveAttribute(
      "data-counted",
      "4710000"
    )
    await expect(page.getByTestId("shift-variance")).toHaveAttribute(
      "data-variance",
      "-125000"
    )
    await expect(page.getByTestId("shift-close")).toHaveAttribute(
      "data-needs-approval",
      "true"
    )
    await page.getByTestId("shift-close").click()
    await approve(page, "Counted twice, short")
    await expect(page.getByTestId("shift-locked")).toBeVisible()
    await expect(page.getByTestId("shift-locked-variance")).toHaveAttribute(
      "data-variance",
      "-125000"
    )

    // Back on the bill screen: a new shift opens in one click.
    await page.goto("/cashier")
    await expect(
      page.locator('[data-testid="cashier-shift"][data-status="none"]')
    ).toBeVisible()
    await page.getByTestId("shift-open").click()
    await expect(
      page.locator('[data-testid="cashier-shift"][data-status="open"]')
    ).toBeVisible()
  }
})
