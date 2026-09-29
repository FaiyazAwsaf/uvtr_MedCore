import { expect, test, type Page } from "@playwright/test"

import { launchByUrl } from "./launchers/helpers"

/**
 * The demo's procurement loop across three windows (plan §15, minute 13):
 * the store receives PO-1042 (S12), the vendor bills 6% above the PO price,
 * the mismatch reaches the finance worklist and the CEO's exception tiles
 * live, finance pays it at the PO price, and the payable appears live while
 * the CEO's tile clears.
 */

const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

async function open(page: Page, path: string, persona: string, testId: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}persona=${persona}`)
  await expect(page.getByTestId(testId).first()).toBeVisible({ timeout: 30_000 })
}

const count = async (page: Page, selector: string) =>
  Number((await page.locator(selector).getAttribute("data-count")) ?? "0")

test("procurement loop: GRN, a vendor invoice 6% over, finance resolves it, the CEO tile follows live", async ({
  context,
  page,
}) => {
  const MISMATCH_TILE = '[data-testid="exception-tile"][data-kind="mismatch"]'
  const OPEN_PAYABLES = '[data-testid="payable-row"][data-status="open"]'

  const ceo = await context.newPage()
  await open(ceo, "/ceo", "per_ceo_anwar", "kpi-billed")
  // A fresh demo has one mismatch: PO-1038, billed 6% over (seeded history).
  await expect(ceo.locator(MISMATCH_TILE)).toHaveAttribute("data-count", "1")
  const mismatchesBefore = await count(ceo, MISMATCH_TILE)

  const finance = await context.newPage()
  await open(finance, "/finance/payables", "per_finance_sabrina", "payables-screen")
  // The seed has one open payable: wait for the list to render before counting.
  await expect(finance.locator(OPEN_PAYABLES).first()).toBeVisible()
  const payablesBefore = await finance.locator(OPEN_PAYABLES).count()

  // Store: S12, receive 80 good and 5 short-dated, then the vendor's invoice at +6%.
  await page.goto("/?persona=per_store_habibur")
  await launchByUrl(page, "S12")
  await expect(page).toHaveURL(/\/store\/grn\?po=/)
  const form = page.getByTestId("grn-form")
  await expect(form).toBeVisible()
  const poNo = (await form.getAttribute("data-po-no"))!
  await page.getByTestId("grn-batch").nth(0).fill("NPLOOPA")
  await page.getByTestId("grn-expiry").nth(0).fill(isoIn(730))
  await page.getByTestId("grn-received").nth(0).fill("80")
  await page.getByTestId("grn-add-lot").click()
  await page.getByTestId("grn-batch").nth(1).fill("NPLOOPS")
  await page.getByTestId("grn-received").nth(1).fill("5")
  await page.getByTestId("grn-expiry").nth(1).fill(isoIn(60))
  await page.getByTestId("grn-post").click()
  await expect(page.getByTestId("grn-summary")).toHaveText("80 received · 20 pending")

  await page.getByTestId("vi-open").click()
  await page.getByTestId("vi-ref").fill("BX-INV-LOOP-1")
  const price = page.getByTestId("vi-price").first()
  const poPrice = Number((await price.inputValue()).replace(/,/g, ""))
  await price.fill((Math.round(poPrice * 106) / 100).toFixed(2))
  await page.getByTestId("vi-save").click()
  await expect(page.getByTestId("vi-result")).toHaveAttribute("data-status", "mismatch")
  await page.getByTestId("vi-close").click()

  // The CEO's mismatch tile counts it at once.
  await expect(ceo.locator(MISMATCH_TILE)).toHaveAttribute("data-count", String(mismatchesBefore + 1))

  // Finance resolves it at the PO price: a payable appears, the tile clears.
  const worklist = await context.newPage()
  await open(worklist, "/finance/match", "per_finance_sabrina", "match-row")
  const row = worklist.locator('[data-testid="match-row"][data-status="mismatch"]').filter({ hasText: poNo })
  await expect(row).toHaveCount(1)
  const matchId = (await row.getAttribute("data-match-id"))!
  await expect(row.getByTestId("match-diff")).toHaveCount(1)
  await row.locator('[data-testid="match-resolve"][data-resolution="pay-po-price"]').click()
  await worklist.getByTestId("match-note").fill("Depot billed 6% over the agreed price; pay the PO price")
  await worklist.getByTestId("match-resolve-confirm").click()
  await expect(worklist.locator(`[data-testid="match-row"][data-match-id="${matchId}"]`)).toHaveAttribute(
    "data-status",
    "resolved"
  )

  await expect(finance.locator(OPEN_PAYABLES)).toHaveCount(payablesBefore + 1)
  await expect(finance.locator(OPEN_PAYABLES).filter({ hasText: poNo })).toHaveCount(1)
  await expect(ceo.locator(MISMATCH_TILE)).toHaveAttribute("data-count", String(mismatchesBefore))
})
