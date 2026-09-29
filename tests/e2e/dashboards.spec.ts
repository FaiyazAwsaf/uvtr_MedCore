import { expect, test, type BrowserContext, type Page } from "@playwright/test"

/**
 * The executive dashboard (plan §9 `/ceo`, §15 minute 13): Anwar's window
 * loads Today, switches to 30 days, drills Dhanmondi to its lab sections and
 * back; a cashier checkout in another window raises Billed and Collected
 * live; cutting Dhanmondi's internet shows it offline with its as-at time.
 */

async function openAs(context: BrowserContext, path: string, persona: string) {
  const page = await context.newPage()
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}persona=${persona}`)
  return page
}

async function openCeo(context: BrowserContext, path = "/ceo") {
  const ceo = await openAs(context, path, "per_ceo_anwar")
  await expect(ceo.getByTestId("ceo-dashboard")).toHaveAttribute(
    "data-ready",
    "true"
  )
  return ceo
}

async function valueOf(page: Page, testId: string): Promise<number> {
  return Number(await page.getByTestId(testId).getAttribute("data-value"))
}

async function values(page: Page, selector: string): Promise<number[]> {
  return page
    .locator(selector)
    .evaluateAll((els) =>
      els.map((el) => Number(el.getAttribute("data-value")))
    )
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

test("loads Today, switches period and drills from a branch to its lab sections and back", async ({
  context,
}) => {
  const ceo = await openCeo(context)
  await expect(ceo.getByTestId("ceo-period")).toHaveAttribute(
    "data-period",
    "today"
  )
  await expect(ceo.getByTestId("freshness")).toContainText("Data as at")
  expect(await valueOf(ceo, "kpi-billed")).toBeGreaterThan(0)
  expect(await valueOf(ceo, "kpi-collected")).toBeGreaterThan(0)
  expect(await valueOf(ceo, "kpi-visits")).toBeGreaterThan(0)
  await expect(ceo.getByTestId("branch-row")).toHaveCount(5)
  await expect(ceo.getByTestId("branch-total")).toHaveAttribute(
    "data-value",
    String(await valueOf(ceo, "kpi-billed"))
  )
  await expect(
    ceo.locator('[data-testid="exception-tile"][data-kind="mismatch"]')
  ).toHaveAttribute("data-count", "1")
  await expect(
    ceo.locator('[data-testid="exception-tile"][data-kind="deposit"]')
  ).toHaveAttribute("data-count", "1")

  // The mismatch tile lists references only.
  await ceo
    .locator('[data-testid="exception-tile"][data-kind="mismatch"]')
    .click()
  await expect(ceo.getByTestId("exception-list")).toContainText("PO-1038")
  await ceo.keyboard.press("Escape")
  await expect(ceo.getByTestId("exception-list")).toHaveCount(0)

  // 30 days: the trend and yesterday's B3 lab TAT spike.
  await ceo
    .getByTestId("ceo-period")
    .getByRole("tab", { name: "30 days" })
    .click()
  await expect(ceo.getByTestId("ceo-period")).toHaveAttribute(
    "data-period",
    "30d"
  )
  await expect(ceo).toHaveURL(/period=30d/)
  await expect(ceo.getByTestId("trend-chart")).toHaveAttribute(
    "data-points",
    "30"
  )
  await expect(ceo.getByTestId("tat-peak")).toHaveAttribute("data-branch", "B3")

  // Dhanmondi: its departments add up to the branch.
  await ceo.locator('[data-testid="drill-branch"][data-branch="B1"]').click()
  await expect(ceo).toHaveURL(/branch=B1/)
  await expect(ceo.getByTestId("drill-dept")).toHaveCount(5)
  const branchTotal = Number(
    await ceo.getByTestId("drill-total").getAttribute("data-value")
  )
  expect(sum(await values(ceo, '[data-testid="drill-dept"]'))).toBe(branchTotal)
  expect(await valueOf(ceo, "kpi-billed")).toBe(branchTotal)

  // Its lab: the sections add up to the department.
  const lab = ceo.locator('[data-testid="drill-dept"][data-dept="lab"]')
  const labValue = Number(await lab.getAttribute("data-value"))
  await lab.click()
  await expect(ceo).toHaveURL(/dept=lab/)
  await expect(
    ceo.locator('[data-testid="drill-service"][data-service="haematology"]')
  ).toBeVisible()
  expect(sum(await values(ceo, '[data-testid="drill-service"]'))).toBe(labValue)

  // Back up the breadcrumb.
  await ceo.locator('[data-testid="drill-crumb"][data-level="branch"]').click()
  await expect(ceo.getByTestId("drill-dept")).toHaveCount(5)
  await ceo.locator('[data-testid="drill-crumb"][data-level="network"]').click()
  await expect(ceo.getByTestId("branch-row")).toHaveCount(5)
  await expect(ceo).not.toHaveURL(/branch=/)

  // A linked view opens as linked.
  await ceo.goto("/ceo?period=7d&branch=B3&dept=lab")
  await expect(ceo.getByTestId("ceo-period")).toHaveAttribute(
    "data-period",
    "7d"
  )
  await expect(ceo.getByTestId("ceo-branch-filter")).toHaveAttribute(
    "data-branch",
    "B3"
  )
  await expect(ceo.getByTestId("drill-service").first()).toBeVisible()
})

test("a payment at the cashier raises Billed and Collected in the CEO window live", async ({
  context,
}) => {
  const ceo = await openCeo(context)
  const billed = await valueOf(ceo, "kpi-billed")
  const collected = await valueOf(ceo, "kpi-collected")
  const b1Before = Number(
    await ceo
      .locator('[data-testid="branch-row"][data-branch="B1"]')
      .getAttribute("data-billed")
  )

  const cashier = await openAs(context, "/cashier", "per_cashier_rafiq")
  await cashier.getByTestId("cashier-open-bill").first().click()
  await expect(cashier.getByTestId("basket-line").first()).toBeVisible()
  if (
    (await cashier
      .locator('[data-testid="basket-line"][data-selected="true"]')
      .count()) === 0
  ) {
    await cashier.getByTestId("basket-select").first().click()
  }
  await cashier
    .locator('[data-testid="tender-add"][data-tender="cash"]')
    .click()
  await expect(cashier.getByTestId("tender-balance")).toHaveAttribute(
    "data-left",
    "0"
  )
  await cashier.getByTestId("cashier-pay").click()
  await expect(cashier.getByTestId("payment-done")).toBeVisible()

  await expect.poll(() => valueOf(ceo, "kpi-billed")).toBeGreaterThan(billed)
  await expect
    .poll(() => valueOf(ceo, "kpi-collected"))
    .toBeGreaterThan(collected)
  const raised = (await valueOf(ceo, "kpi-billed")) - billed
  // Paid in cash: all of it is collected (a company's share, if any, is not).
  expect((await valueOf(ceo, "kpi-collected")) - collected).toBeLessThanOrEqual(
    raised
  )
  await expect(
    ceo.locator('[data-testid="branch-row"][data-branch="B1"]')
  ).toHaveAttribute("data-billed", String(b1Before + raised))
  // The changed figure flashes.
  await expect(ceo.getByTestId("kpi-billed")).not.toHaveAttribute(
    "data-flash",
    "0"
  )
})

test("cutting B1 shows it offline with its as-at time until it reconnects", async ({
  context,
}) => {
  const ceo = await openCeo(context)
  await ceo.getByTestId("demo-panel-trigger").click()
  await ceo.getByRole("tab", { name: "Clock and network" }).click()
  await ceo.getByTestId("network-cut-B1").click()
  await expect(ceo.getByTestId("network-B1")).toHaveAttribute(
    "data-status",
    "offline"
  )
  await ceo.keyboard.press("Escape")

  const row = ceo.locator('[data-testid="branch-row"][data-branch="B1"]')
  await expect(row).toHaveAttribute("data-status", "offline")
  await expect(row).toContainText("Offline · data as at")
  await expect(
    ceo.locator('[data-testid="freshness-offline"][data-branch="B1"]')
  ).toContainText("B1 offline · data as at")
  await expect(
    ceo.locator('[data-testid="branch-row"][data-branch="B2"]')
  ).toHaveAttribute("data-status", "online")

  await ceo.getByTestId("demo-panel-trigger").click()
  await ceo.getByTestId("network-reconnect-B1").click()
  await expect(ceo.getByTestId("network-B1")).toHaveAttribute(
    "data-status",
    "online"
  )
  await ceo.keyboard.press("Escape")
  await expect(row).toHaveAttribute("data-status", "online")
  await expect(ceo.getByTestId("freshness-offline")).toHaveCount(0)
})
