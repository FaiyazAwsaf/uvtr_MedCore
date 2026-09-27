import { expect, test } from "@playwright/test"

/** Launcher, Demo Wall and audit tamper checks for the demo tooling (WS-Shell). */

const ROLES = [
  "receptionist",
  "doctor",
  "labtech",
  "pathologist",
  "pharmacist",
  "cashier",
  "store",
  "finance",
  "ceo",
  "patient",
]

test("the launcher lists every role and opens a persona in this window", async ({
  page,
}) => {
  await page.goto("/")
  for (const role of ROLES) {
    await expect(page.getByTestId(`role-card-${role}`)).toBeVisible()
  }
  await expect(page.getByTestId("role-persona-doctor")).toHaveText(
    "Dr. Kamal Hossain"
  )
  await page.getByTestId("open-here-pharmacist").click()
  await expect(page).toHaveURL(/\/pharmacy$/)
})

test("the Demo Wall shows four named panes that expand and restore", async ({
  page,
}) => {
  await page.goto("/wall")
  await expect(page.locator("iframe")).toHaveCount(4)
  const panes = [
    ["1", "/doctor?persona=per_doctor_kamal&scale=0.9"],
    ["2", "/pharmacy?persona=per_pharmacist_shirin&scale=0.9"],
    ["3", "/lab?persona=per_labtech_rubel&scale=0.9"],
    ["4", "/cashier?persona=per_cashier_rafiq&scale=0.9"],
  ]
  for (const [n, src] of panes) {
    await expect(page.locator(`iframe[name="mc-wall-${n}"]`)).toHaveAttribute(
      "src",
      src
    )
  }
  await page.getByTestId("wall-expand-2").click()
  await expect(page.getByTestId("wall-pane-1")).toBeHidden()
  await expect(page.getByTestId("wall-pane-2")).toBeVisible()
  await page.getByTestId("wall-expand-2").click()
  await expect(page.getByTestId("wall-pane-1")).toBeVisible()
})

test("the tamper test breaks the audit chain and the viewer names the row", async ({
  page,
}) => {
  await page.goto("/?persona=per_reception_farhana")
  await page.getByTestId("demo-panel-trigger").click()
  await page.getByRole("tab", { name: "Data" }).click()
  await page.getByTestId("demo-tamper-button").click()
  const note = page.getByTestId("demo-tampered")
  await expect(note).toBeVisible()
  const seq = /row (\d+)/.exec((await note.textContent()) ?? "")?.[1]
  expect(seq).toBeTruthy()

  await page.goto("/audit")
  const chain = page.getByTestId("audit-chain")
  await expect(chain).toHaveAttribute("data-state", "broken")
  await expect(chain).toContainText(`Chain broken at row ${seq}`)
  await expect(
    page.locator(`[data-testid="audit-row"][data-seq="${seq}"]`)
  ).toBeVisible()
})
