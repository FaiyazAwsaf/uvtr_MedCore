import { expect, test, type Page } from "@playwright/test"

/**
 * Lab and pathology launchers (plan §10, P3.3): S5, S6, S6B, S7 and S8 each
 * run twice in a row, switch the window to their persona and screen with the
 * cue card open, and the presenter's key action commits every time.
 */

const SETUP_TIMEOUT = 30_000

async function openPanel(page: Page) {
  if (!(await page.getByTestId("demo-panel").isVisible())) {
    await page.getByTestId("demo-panel-trigger").click()
  }
  await expect(page.getByTestId("demo-panel")).toBeVisible()
}

/** Launch from the demo panel's Scenarios tab, as the presenter does. */
async function launch(page: Page, id: string) {
  await openPanel(page)
  await page.getByRole("tab", { name: "Scenarios" }).click()
  await page
    .locator(`[data-testid="scenario-launch"][data-scenario-id="${id}"]`)
    .click()
  await expect(page.getByTestId("demo-panel")).toBeHidden({
    timeout: SETUP_TIMEOUT,
  })
  await expect(
    page.locator(`[data-testid="cue-card"][data-scenario-id="${id}"]`)
  ).toBeVisible({ timeout: SETUP_TIMEOUT })
}

/** Launch by address (`?launch=<id>`), as bookmarks and the 4-window opener do. */
async function launchByUrl(page: Page, id: string, from: string) {
  await page.goto(`${from}${from.includes("?") ? "&" : "?"}launch=${id}`)
  await expect(
    page.locator(`[data-testid="cue-card"][data-scenario-id="${id}"]`)
  ).toBeVisible({ timeout: SETUP_TIMEOUT })
}

async function forwardClock(page: Page, times: number) {
  await openPanel(page)
  await page.getByRole("tab", { name: "Clock and network" }).click()
  const plus15 = page
    .getByTestId("demo-clock")
    .getByRole("button", { name: "+15m" })
  for (let i = 0; i < times; i++) await plus15.click()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("demo-panel")).toBeHidden()
}

test("S5 rejects the highlighted haemolysed tube and orders a free recollection, twice", async ({
  page,
}) => {
  await page.goto("/?persona=per_labtech_rubel")
  for (let run = 0; run < 2; run++) {
    await launch(page, "S5")
    await expect(page).toHaveURL(/\/lab\/reception\?focus=/)
    const row = page.locator(
      '[data-testid="receive-row"][data-focused="true"]'
    )
    await expect(row).toBeVisible({ timeout: SETUP_TIMEOUT })
    const specimenId = await row.getAttribute("data-specimen-id")
    await row.getByTestId("reject-open").click()
    await page
      .getByTestId("reject-reason")
      .locator('[data-reason="haemolysed"]')
      .click()
    await page.getByTestId("reject-confirm").click()
    await expect(page.getByTestId("reject-dialog")).toBeHidden()
    const rejected = page.locator(
      `[data-testid="rejected-row"][data-specimen-id="${specimenId}"]`
    )
    await expect(rejected.getByTestId("rejected-recollection")).toContainText(
      "Free"
    )
    await expect(
      page.locator(
        `[data-testid="receive-row"][data-specimen-id="${specimenId}"]`
      )
    ).toHaveCount(0)
  }
})

test("S6 approves an add-on on the same serum tube and bills it, twice", async ({
  page,
}) => {
  await page.goto("/?persona=per_labtech_rubel")
  for (let run = 0; run < 2; run++) {
    await launch(page, "S6")
    await expect(page).toHaveURL(/\/lab\/reception\?focus=/)
    const focused = page.locator(
      '[data-testid="addon-row"][data-focused="true"]'
    )
    await expect(focused).toHaveAttribute("data-state", "pending", {
      timeout: SETUP_TIMEOUT,
    })
    const itemId = await focused.getAttribute("data-item-id")
    const row = page.locator(
      `[data-testid="addon-row"][data-item-id="${itemId}"]`
    )
    await expect(row.getByTestId("addon-stability")).toHaveAttribute(
      "data-ok",
      "true"
    )
    await expect(row.getByTestId("addon-volume")).toHaveAttribute(
      "data-ok",
      "true"
    )
    await row.getByTestId("addon-approve").click()
    await expect(row).toHaveAttribute("data-state", "approved")
    await expect(row.getByTestId("addon-decision")).toContainText(
      "awaiting payment"
    )
  }
})

test("S6B blocks approval beyond stability and orders a new collection, twice", async ({
  page,
}) => {
  await page.goto("/?persona=per_labtech_rubel")
  for (let run = 0; run < 2; run++) {
    await launch(page, "S6B")
    const focused = page.locator(
      '[data-testid="addon-row"][data-focused="true"]'
    )
    await expect(focused).toHaveAttribute("data-state", "pending", {
      timeout: SETUP_TIMEOUT,
    })
    const itemId = await focused.getAttribute("data-item-id")
    const row = page.locator(
      `[data-testid="addon-row"][data-item-id="${itemId}"]`
    )
    await expect(row.getByTestId("addon-stability")).toHaveAttribute(
      "data-ok",
      "false"
    )
    await expect(row.getByTestId("addon-approve")).toBeDisabled()
    await row.getByTestId("addon-new-collection").click()
    await expect(row).toHaveAttribute("data-state", "new-collection")
  }
  // The new tube waits in Collection until the add-on is paid.
  await page.goto("/lab")
  await expect(
    page.locator('[data-testid="collect-row"][data-unpaid="true"]').first()
  ).toBeVisible()
})

test("S7 logs the critical call, turns overdue after +15m +15m, and escalates to the duty doctor, twice", async ({
  page,
}) => {
  await page.goto("/?persona=per_pathologist_mizanur")
  for (let run = 0; run < 2; run++) {
    if (run === 0) await launch(page, "S7")
    else await launchByUrl(page, "S7", "/pathology")
    await expect(page).toHaveURL(/\/pathology\?tab=critical&focus=/)
    const focused = page.locator(
      '[data-testid="critical-row"][data-focused="true"]'
    )
    await expect(focused).toHaveAttribute("data-call-status", "none", {
      timeout: SETUP_TIMEOUT,
    })
    const resultId = await focused.getAttribute("data-result-id")
    const row = page.locator(
      `[data-testid="critical-row"][data-result-id="${resultId}"]`
    )
    await row.getByTestId("critical-log").click()
    await expect(page.getByTestId("critical-person")).toHaveValue(
      "Dr. Kamal Hossain"
    )
    await page.getByTestId("critical-readback").click()
    await page
      .getByTestId("critical-readback-text")
      .fill("potassium six point eight")
    await page.getByTestId("critical-save").click()
    await expect(page.getByTestId("critical-dialog")).toBeHidden()
    await expect(row).toHaveAttribute("data-call-status", "open")
    await expect(row.getByTestId("critical-overdue")).toHaveCount(0)

    await forwardClock(page, 1)
    await expect(row.getByTestId("critical-overdue")).toHaveCount(0)
    await forwardClock(page, 1)
    await expect(row.getByTestId("critical-overdue")).toBeVisible()
    await row.getByTestId("critical-escalate").click()
    await expect(row).toHaveAttribute("data-call-status", "escalated")
    await expect(row.getByTestId("critical-escalated")).toContainText(
      "Dr. Saiful Islam"
    )
  }
})

test("S8 corrects the released TSH report to v2 and the QR page points to v2, twice", async ({
  page,
}) => {
  await page.goto("/?persona=per_pathologist_mizanur")
  for (let run = 0; run < 2; run++) {
    if (run === 0) await launch(page, "S8")
    else await launchByUrl(page, "S8", "/pathology")
    await expect(page).toHaveURL(/\/pathology\?tab=released&focus=/)
    const focused = page.locator(
      '[data-testid="report-row"][data-focused="true"]'
    )
    await expect(focused).toHaveAttribute("data-status", "released", {
      timeout: SETUP_TIMEOUT,
    })
    const v1Id = await focused.getAttribute("data-report-id")
    const reportNo = await focused.getAttribute("data-report-no")
    await focused.getByTestId("report-correct").click()
    const dialog = page.getByTestId("correct-dialog")
    await dialog
      .locator('[data-testid="correct-value"][data-analyte="TSH"]')
      .fill("5.2")
    await dialog
      .getByTestId("correct-reason")
      .fill("Unit conversion error at result entry")
    await dialog.getByTestId("correct-confirm").click()
    await expect(dialog).toBeHidden()
    await expect(
      page.locator(
        `[data-testid="report-row"][data-report-no="${reportNo}"][data-version="2"]`
      )
    ).toHaveAttribute("data-status", "released")
    await expect(
      page.locator(`[data-testid="report-row"][data-report-id="${v1Id}"]`)
    ).toHaveAttribute("data-status", "superseded")

    await page.goto(`/verify/${v1Id}`)
    await expect(page.getByTestId("verify-status")).toHaveAttribute(
      "data-state",
      "superseded"
    )
    await expect(page.getByTestId("verify-current-link")).toBeVisible()
  }
})
