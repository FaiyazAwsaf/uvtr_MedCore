import { expect, test } from "@playwright/test"

/**
 * The procurement loop across windows (objective §3D): a low-stock alert
 * becomes a purchase request, it routes by value to the head of
 * procurement, who approves it in his own window (live), and the store
 * manager issues PO-1042. The CFO decides the request above ৳5 lakh.
 */

test("request from the alert and the library, approved live by Tariq, then PO-1042 issued", async ({
  context,
}) => {
  const habibur = await context.newPage()
  await habibur.goto("/store?persona=per_store_habibur")
  const alert = habibur.locator('[data-testid="low-stock-row"][data-brand-id="brd_napa_500mg"]')
  await expect(alert).toContainText("Napa 500 mg below reorder level")
  await alert.getByTestId("low-stock-add").click()

  await expect(habibur.locator('[data-testid="pr-line"][data-brand-id="brd_napa_500mg"]')).toBeVisible()
  await habibur.getByTestId("pr-qty").first().fill("100")
  await habibur.getByTestId("pr-search").locator("input").fill("Ace 500")
  await habibur.locator('[data-testid="medicine-option"][data-brand-id="brd_ace_500mg"]').click()
  await expect(habibur.getByTestId("pr-line")).toHaveCount(2)
  // His own request: one tier up, to the procurement head.
  await expect(habibur.getByTestId("pr-tier")).toHaveAttribute("data-tier", "procurement-head")
  await expect(habibur.getByTestId("pr-tier-raised")).toBeVisible()
  await habibur.getByTestId("pr-submit").click()

  const view = habibur.getByTestId("pr-view")
  await expect(view).toHaveAttribute("data-status", "submitted")
  const prNo = (await view.getAttribute("data-pr-no"))!

  const tariq = await context.newPage()
  await tariq.goto("/store/approvals?persona=per_store_tariq")
  const row = tariq.locator(`[data-testid="approval-row"][data-pr-no="${prNo}"]`)
  await row.getByTestId("approval-approve").click()
  await tariq.getByTestId("approval-confirm").click()
  await expect(row).toHaveCount(0)

  // Habibur's window follows without a reload.
  await expect(view).toHaveAttribute("data-status", "approved")
  await habibur.goto("/store/po")
  await habibur.locator(`[data-testid="po-issue"][data-pr-no="${prNo}"]`).click()
  await habibur.getByTestId("po-issue-confirm").click()
  await expect(habibur.locator('[data-testid="po-row"][data-po-no="PO-1042"]')).toHaveAttribute(
    "data-status",
    "issued"
  )
  await expect(
    habibur.locator('[data-testid="po-pending"][data-po-no="PO-1042"]')
  ).toHaveAttribute("data-pending", "100")
})

test("the CFO decides the ৳5.29 lakh Uttara request at /finance/approvals", async ({ page }) => {
  await page.goto("/finance/approvals?persona=per_finance_sabrina")
  const row = page.locator('[data-testid="approval-row"][data-tier="cfo"]')
  await expect(row).toHaveCount(1)
  await row.getByTestId("approval-reject").click()
  await expect(page.getByTestId("approval-confirm")).toBeDisabled()
  await page.getByTestId("approval-reason").fill("Split it over two quarters")
  await page.getByTestId("approval-confirm").click()
  await expect(row).toHaveCount(0)
  await page.getByRole("tab", { name: "Counter approvals" }).click()
  await expect(page.getByTestId("approval-counter-row").first()).toBeVisible()
})
