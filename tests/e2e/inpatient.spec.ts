import { expect, test, type Page } from "@playwright/test"

/**
 * Inpatient billing and beds (plan §12 WS-J): the receptionist admits into a
 * vacant cabin bed and the stay appears live at the cashier's deposit desk;
 * the sweeper raises the deposit alert; a ৳20,000 cash deposit lands on the
 * cashier's shift and clears it; the planted low stay is topped up; +1 day on
 * the demo clock adds a day and alerts the new stay again; transfer and bed
 * housekeeping; the interim bill prints.
 */

const CABIN = "wrd_B1_5c"

async function openClock(page: Page) {
  if (!(await page.getByTestId("demo-panel").isVisible())) {
    await page.getByTestId("demo-panel-trigger").click()
  }
  await page.getByRole("tab", { name: "Clock and network" }).click()
  await expect(page.getByTestId("demo-clock")).toBeVisible()
}

async function expectedCash(page: Page): Promise<number> {
  const box = page.getByTestId("shift-expected")
  await expect(box).toBeVisible()
  return Number(await box.getAttribute("data-expected"))
}

test("admit at reception, deposit at the cashier, alerts, transfer and the interim bill", async ({
  context,
}) => {
  test.setTimeout(120_000)
  await context.addInitScript(() => {
    const w = window as unknown as { __printed: number; print: () => void }
    w.__printed = 0
    w.print = () => {
      w.__printed += 1
    }
  })
  const desk = await context.newPage()
  const cashier = await context.newPage()
  const shift = await context.newPage()
  await desk.goto("/reception/inpatient?persona=per_reception_farhana")
  await cashier.goto("/cashier/deposits?persona=per_cashier_rafiq")
  await shift.goto("/cashier/shift?persona=per_cashier_rafiq")

  const cabin = desk.locator(`[data-testid="bed-board-ward"][data-ward-id="${CABIN}"]`)
  await expect(cabin).toBeVisible()
  await expect(cashier.getByTestId("deposit-row").first()).toBeVisible()
  const cashBefore = await expectedCash(shift)

  /* Admit into a vacant cabin bed */
  const vacant = cabin.locator('[data-testid="bed-tile"][data-status="vacant"]').first()
  const bedId = (await vacant.getAttribute("data-bed-id"))!
  await vacant.click()
  await desk.getByTestId("bed-dialog").getByTestId("admit-open").click()
  const admitDialog = desk.getByTestId("admit-dialog")
  await expect(admitDialog.getByTestId("admit-bed")).toHaveValue(bedId)
  await admitDialog.getByTestId("admit-patient").getByRole("combobox").fill("Abdul Karim")
  await desk.getByRole("listbox").getByRole("option").filter({ hasText: "Abdul Karim" }).first().click()
  await admitDialog.getByTestId("admit-consultant").selectOption({ index: 1 })
  await admitDialog.getByTestId("admit-reason").selectOption({ index: 1 })
  await admitDialog.getByTestId("admit-save").click()
  const admissionNo = (await admitDialog.getByTestId("admission-no").textContent())!.trim()
  expect(admissionNo).toMatch(/^ADM-B1-\d{6}$/)
  await desk.keyboard.press("Escape")
  await expect(admitDialog).toHaveCount(0)
  const tile = desk.locator(`[data-testid="bed-tile"][data-bed-id="${bedId}"]`)
  await expect(tile).toHaveAttribute("data-status", "occupied")

  /* Live at the cashier; the sweeper raises the alert (no deposit yet) */
  const row = cashier.locator(`[data-testid="deposit-row"][data-admission-no="${admissionNo}"]`)
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute("data-low", "true")
  await expect(row.getByTestId("deposit-alert")).toBeVisible()
  await expect(tile.getByTestId("deposit-alert")).toBeVisible()

  /* ৳20,000 cash on Rafiq's shift clears it */
  await row.getByTestId("deposit-open").click()
  const depositDialog = cashier.getByTestId("deposit-dialog")
  await depositDialog.getByTestId("deposit-amount").fill("20000")
  await depositDialog.locator('[data-testid="deposit-tender"][data-tender="cash"]').click()
  await depositDialog.getByTestId("deposit-save").click()
  const receipt = depositDialog.getByTestId("deposit-receipt")
  await expect(receipt).toBeVisible()
  await expect(receipt).toHaveAttribute("data-receipt-no", /^RC-B1-\d{6}$/)
  await expect(receipt).toHaveAttribute("data-alert-cleared", "true")
  await cashier.keyboard.press("Escape")
  await expect(row).toHaveAttribute("data-low", "false")
  await expect(row.getByTestId("deposit-alert")).toHaveCount(0)
  await expect(tile.getByTestId("deposit-alert")).toHaveCount(0)
  await expect(shift.getByTestId("shift-expected")).toHaveAttribute(
    "data-expected",
    String(cashBefore + 20_000_00)
  )

  /* The planted low stay shows the alert; a bKash top-up restores it */
  const planted = cashier
    .locator('[data-testid="deposit-row"][data-low="true"]')
    .filter({ has: cashier.getByTestId("deposit-alert") })
    .first()
  const plantedNo = (await planted.getAttribute("data-admission-no"))!
  await planted.getByTestId("deposit-open").click()
  await depositDialog.getByTestId("deposit-quick").first().click()
  await depositDialog.locator('[data-testid="deposit-tender"][data-tender="bkash"]').click()
  await expect(depositDialog.getByTestId("deposit-save")).toBeDisabled()
  await depositDialog.getByTestId("deposit-approve").click()
  await expect(depositDialog.getByTestId("deposit-approved")).toContainText("BK")
  await depositDialog.getByTestId("deposit-save").click()
  await expect(depositDialog.getByTestId("deposit-receipt")).toHaveAttribute("data-alert-cleared", "true")
  await cashier.keyboard.press("Escape")
  const plantedRow = cashier.locator(`[data-testid="deposit-row"][data-admission-no="${plantedNo}"]`)
  await expect(plantedRow).toHaveAttribute("data-low", "false")
  await expect(plantedRow.getByTestId("deposit-alert")).toHaveCount(0)

  /* +1 day: every bill gains a day, and the new stay crosses the alert level again */
  const days = Number(await row.getAttribute("data-days"))
  await openClock(desk)
  await desk.getByTestId("demo-clock").getByRole("button", { name: "+1d" }).click()
  await desk.keyboard.press("Escape")
  await expect(row).toHaveAttribute("data-days", String(days + 1))
  await expect(row).toHaveAttribute("data-low", "true")
  await expect(row.getByTestId("deposit-alert")).toBeVisible()

  /* Interim bill: view and print */
  await row.getByTestId("interim-open").click()
  const total = cashier.getByTestId("interim-total")
  await expect(total).toHaveAttribute("data-days", String(days + 1))
  await expect(total).toHaveAttribute("data-deposits", String(20_000_00))
  await expect(cashier.getByTestId("interim-sheet")).toContainText("Interim bill: not a final invoice")
  await expect(cashier.getByTestId("interim-sheet")).toContainText(admissionNo)
  await cashier.getByTestId("interim-print").click()
  await expect.poll(() => cashier.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1)
  await cashier.keyboard.press("Escape")

  /* Transfer to another bed at reception; the old bed goes for cleaning, then is made ready */
  await tile.click()
  const drawer = desk.getByTestId("admission-drawer")
  await expect(drawer).toHaveAttribute("data-admission-no", admissionNo)
  await drawer.getByTestId("transfer-open").click()
  const target = drawer.getByTestId("transfer-bed").first()
  const toBed = (await target.getAttribute("data-bed-id"))!
  await target.click()
  await expect(drawer).toHaveAttribute("data-bed-id", toBed)
  await desk.keyboard.press("Escape")
  await expect(tile).toHaveAttribute("data-status", "cleaning")
  await expect(desk.locator(`[data-testid="bed-tile"][data-bed-id="${toBed}"]`)).toHaveAttribute(
    "data-status",
    "occupied"
  )
  await tile.click()
  await desk.getByTestId("bed-ready").click()
  await expect(tile).toHaveAttribute("data-status", "vacant")
  await tile.click()
  await desk.getByTestId("bed-reserve").click()
  await expect(tile).toHaveAttribute("data-status", "reserved")
})

test("two windows admitting into the same bed: the second gets the conflict dialog", async ({ context }) => {
  const a = await context.newPage()
  const b = await context.newPage()
  await a.goto("/reception/inpatient?persona=per_reception_farhana")
  await b.goto("/reception/inpatient?persona=per_reception_farhana")
  const vacantA = a
    .locator(`[data-testid="bed-board-ward"][data-ward-id="${CABIN}"] [data-testid="bed-tile"][data-status="vacant"]`)
    .first()
  const bedId = (await vacantA.getAttribute("data-bed-id"))!

  const openAdmit = async (page: Page, name: string) => {
    await page.locator(`[data-testid="bed-tile"][data-bed-id="${bedId}"]`).click()
    await page.getByTestId("bed-dialog").getByTestId("admit-open").click()
    const dialog = page.getByTestId("admit-dialog")
    await dialog.getByTestId("admit-patient").getByRole("combobox").fill(name)
    await page.getByRole("listbox").getByRole("option").filter({ hasText: name }).first().click()
    await dialog.getByTestId("admit-consultant").selectOption({ index: 1 })
    await dialog.getByTestId("admit-reason").selectOption({ index: 2 })
    return dialog
  }
  const dialogA = await openAdmit(a, "Abdul Karim")
  const dialogB = await openAdmit(b, "Tanvir Karim")
  await dialogA.getByTestId("admit-save").click()
  await expect(dialogA.getByTestId("admission-no")).toBeVisible()
  await dialogB.getByTestId("admit-save").click()
  await expect(b.getByRole("dialog", { name: "This record was changed" })).toBeVisible()
})
