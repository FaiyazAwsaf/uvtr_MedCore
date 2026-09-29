import { expect, test, type BrowserContext, type Page } from "@playwright/test"

/**
 * Finance (WS-I) smoke: the Nagad settlement file imports and reconciles,
 * PO-1038's mismatch resolves at the PO price, a payable is scheduled and
 * paid, Dr. Kamal's statement reproduces, a corporate credit note reduces
 * what the company owes, the journal balances and downloads, and a payment
 * taken at the cashier in another window shows in cash control and today's
 * journal at once.
 */

async function openAs(context: BrowserContext, route: string, persona: string, testId: string): Promise<Page> {
  const page = await context.newPage()
  const joiner = route.includes("?") ? "&" : "?"
  await page.goto(`${route}${joiner}persona=${persona}`)
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 30_000 })
  return page
}

const attr = async (page: Page, selector: string, name: string) =>
  Number(await page.locator(selector).first().getAttribute(name))

test("MFS: the Nagad file imports and auto-matches every line; bKash keeps its 2 unmatched lines", async ({ context }) => {
  const page = await openAs(context, "/finance/mfs", "per_finance_imran", "mfs-screen")
  const bkash = page.locator('[data-testid="mfs-file"][data-settlement-id="mfs_bkash_yesterday"]')
  await bkash.click()
  await expect(page.locator('[data-testid="mfs-line"][data-matched="false"]')).toHaveCount(2)
  await expect(page.locator('[data-testid="mfs-line"][data-ref="BK7QM2K9TD"]')).toHaveAttribute("data-matched", "false")

  // An unmatched line takes a note for follow-up.
  await page.locator('[data-testid="mfs-line"][data-ref="BK3XH8PLZW"]').getByTestId("mfs-note").click()
  await page.getByTestId("mfs-note-input").fill("Under investigation")
  await page.getByTestId("mfs-note-save").click()
  await expect(page.locator('[data-testid="mfs-line"][data-ref="BK3XH8PLZW"]')).toContainText("Under investigation")

  const nagad = page.locator('[data-testid="mfs-file"][data-settlement-id="mfs_nagad_yesterday"]')
  await expect(nagad).toHaveAttribute("data-status", "pending-import")
  await nagad.click()
  await page.getByTestId("mfs-import").click()
  await expect(nagad).toHaveAttribute("data-status", "reconciled")
  await expect(page.locator('[data-testid="mfs-line"][data-matched="false"]')).toHaveCount(0)
  expect(await page.locator('[data-testid="mfs-line"][data-matched="true"]').count()).toBeGreaterThan(0)
  await page.close()
})

test("three-way match and payables: PO-1038 resolves at the PO price, then its payable is scheduled and paid", async ({ context }) => {
  const page = await openAs(context, "/finance/match", "per_finance_imran", "match-screen")
  const open = page.locator('[data-testid="match-row"][data-status="mismatch"]').filter({ hasText: "PO-1038" })
  await expect(open).toHaveCount(1)
  const matchId = (await open.getAttribute("data-match-id"))!
  await expect(open.getByTestId("match-diff")).toHaveCount(1)
  await open.locator('[data-testid="match-resolve"][data-resolution="pay-po-price"]').click()
  await page.getByTestId("match-note").fill("Pay the agreed PO price")
  await page.getByTestId("match-resolve-confirm").click()
  await expect(page.locator(`[data-testid="match-row"][data-match-id="${matchId}"]`)).toHaveAttribute(
    "data-status",
    "resolved"
  )

  await page.goto("/finance/payables")
  await expect(page.getByTestId("payables-screen")).toBeVisible()
  const rows = page.locator('[data-testid="payable-row"][data-status="open"]')
  await expect(rows).toHaveCount(2)
  const row = rows.filter({ hasText: "PO-1038" })
  const payableId = (await row.getAttribute("data-payable-id"))!
  const target = page.locator(`[data-testid="payable-row"][data-payable-id="${payableId}"]`)
  await target.getByTestId("payable-schedule").click()
  await page.getByTestId("payable-schedule-confirm").click()
  await expect(target).toHaveAttribute("data-status", "scheduled")
  await target.getByTestId("payable-pay").click()
  await page.getByTestId("payable-pay-confirm").click()
  await page.getByRole("tab", { name: "Paid" }).click()
  await expect(target).toHaveAttribute("data-status", "paid")
  await expect(target).toContainText(/BEFTN-[A-Z2-9]{8}/)
  await page.close()
})

test("fee share: Dr. Kamal's last month loads, about 120 lines with 1 reversal, and every line reproduces", async ({ context }) => {
  const page = await openAs(context, "/finance/fee-share", "per_finance_sabrina", "fee-share-screen")
  await expect(page.getByTestId("feeshare-doctor")).toHaveValue("doc_kamal_hossain")
  const lines = page.getByTestId("feeshare-line")
  await expect.poll(() => lines.count()).toBeGreaterThanOrEqual(110)
  expect(await lines.count()).toBeLessThanOrEqual(130)
  await expect(page.locator('[data-testid="feeshare-line"][data-reversal="true"]')).toHaveCount(1)
  await expect(page.getByTestId("feeshare-reproduce")).toHaveAttribute("data-ok", "true")
  await expect(page.getByTestId("feeshare-reproduce")).toContainText(`All ${await lines.count()} lines reproduce`)
  expect(await attr(page, '[data-testid="feeshare-total"]', "data-share")).toBeGreaterThan(0)
  await page.close()
})

test("corporate: a credit note on a statement line reduces what the company owes", async ({ context }) => {
  const page = await openAs(context, "/finance/corporate", "per_finance_imran", "corporate-screen")
  const line = page.getByTestId("corp-statement-line").first()
  await expect(line).toBeVisible()
  const dueBefore = await attr(page, '[data-testid="corp-due"]', "data-due")
  await line.getByTestId("corp-credit-note").click()
  await page.getByTestId("corp-cn-amount").fill("100")
  await page.getByTestId("corp-cn-reason").fill("Disputed by the company")
  await page.getByTestId("corp-cn-save").click()
  await expect(page.getByTestId("corp-cn-done")).toContainText(/CN-C\d-\d{4}-\d{6}/)
  await page.getByTestId("corp-cn-close").click()
  await expect(page.getByTestId("corp-due")).toHaveAttribute("data-due", String(dueBefore - 10_000))
  await page.close()
})

test("accounting export: yesterday's journal balances, downloads as CSV and is recorded", async ({ context }) => {
  const page = await openAs(context, "/finance/export", "per_finance_imran", "export-screen")
  const preview = page.getByTestId("export-preview")
  await expect(preview).toHaveAttribute("data-balanced", "true")
  const debit = await attr(page, '[data-testid="export-preview"]', "data-debit")
  expect(debit).toBeGreaterThan(0)
  expect(await attr(page, '[data-testid="export-preview"]', "data-credit")).toBe(debit)
  const exportsBefore = await page.getByTestId("export-row").count()

  const download = page.waitForEvent("download")
  await page.getByTestId("export-download").click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^C1-journal-\d{4}-\d{2}-\d{2}\.csv$/)
  await expect(page.getByTestId("export-done")).toBeVisible()
  await expect(page.getByTestId("export-row")).toHaveCount(exportsBefore + 1)

  // Every company's journal for the day balances.
  for (const company of ["C2", "C3"]) {
    await page.getByTestId("export-company").selectOption(company)
    await expect(preview).toHaveAttribute("data-balanced", "true")
  }
  await page.close()
})

test("a cash payment at the cashier shows in cash control and today's journal within a second", async ({ context }) => {
  const control = await openAs(context, "/finance", "per_finance_sabrina", "cash-control")
  const shift = control.locator('[data-testid="cash-shift-row"][data-shift-id="shf_B1_rafiq_today"]')
  await expect(shift).toBeVisible()
  const expectedBefore = Number(await shift.getAttribute("data-expected"))

  const journal = await openAs(context, "/finance/export", "per_finance_imran", "export-screen")
  const today = (await journal.locator('[data-testid="export-date"] option').first().getAttribute("value"))!
  await journal.getByTestId("export-date").selectOption(today)
  const preview = journal.getByTestId("export-preview")
  await expect(preview).toHaveAttribute("data-balanced", "true")
  const debitBefore = Number(await preview.getAttribute("data-debit"))

  const cashier = await openAs(context, "/cashier", "per_cashier_rafiq", "cashier-kpis")
  // The first waiting bill with something due today (fees for later visits start unticked).
  const bills = cashier.getByTestId("cashier-open-bill")
  await expect(bills.first()).toBeVisible()
  const ticked = cashier.locator('[data-testid="basket-line"][data-selected="true"]')
  for (let i = 0; i < (await bills.count()); i++) {
    const patientId = await bills.nth(i).getAttribute("data-patient-id")
    await bills.nth(i).click()
    await expect(cashier.locator(`[data-testid="cashier-patient"][data-patient-id="${patientId}"]`)).toBeVisible()
    await expect(cashier.getByTestId("basket-line").first()).toBeVisible()
    if ((await ticked.count()) > 0) break
  }
  await expect(ticked.first()).toBeVisible()
  await cashier.locator('[data-testid="tender-add"][data-tender="cash"]').click()
  await expect(cashier.getByTestId("tender-balance")).toHaveAttribute("data-left", "0")
  await cashier.getByTestId("cashier-pay").click()
  await expect(cashier.getByTestId("payment-done")).toBeVisible()

  await expect
    .poll(async () => Number(await shift.getAttribute("data-expected")), { timeout: 2_000 })
    .toBeGreaterThan(expectedBefore)
  await expect
    .poll(async () => Number(await preview.getAttribute("data-debit")), { timeout: 2_000 })
    .toBeGreaterThan(debitBefore)
  await expect(preview).toHaveAttribute("data-balanced", "true")
})
