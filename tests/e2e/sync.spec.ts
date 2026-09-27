import { expect, test, type Page } from "@playwright/test"

/**
 * Checkpoint 1, items 2 and 3: two windows in one browser share IndexedDB and
 * the BroadcastChannel bus. An edit in one shows live in the other (data and
 * event stream), and a save made against a stale version conflicts.
 */

async function openEngineCheck(page: Page) {
  await page.getByTestId("demo-panel-trigger").click()
  await page.getByRole("tab", { name: "Engine check" }).click()
  await expect(page.getByTestId("engine-check")).toBeVisible()
}

/**
 * Picks a patient in the engine check. The Phase 1 seed has staff and
 * personas only, so on an empty patients table the dev helper creates a
 * sample patient through the engine; once the full seed lands, the first
 * listed patient is used instead. Returns the displayed UHID.
 */
async function pickAnyPatient(page: Page): Promise<string> {
  const create = page.getByTestId("engine-create-sample")
  const firstRow = page.getByTestId("engine-patient-row").first()
  await expect(create.or(firstRow)).toBeVisible()
  if (await create.isVisible()) await create.click()
  else await firstRow.click()
  const uhid = page.getByTestId("engine-selected-uhid")
  await expect(uhid).toBeVisible()
  return ((await uhid.textContent()) ?? "").trim()
}

async function pickPatient(page: Page, uhid: string) {
  await page.getByTestId("engine-search").fill(uhid)
  await page.getByTestId("engine-patient-row").first().click()
  await expect(page.getByTestId("engine-selected-uhid")).toHaveText(uhid)
}

async function editPhone(page: Page, phone: string) {
  await page.getByTestId("engine-phone-input").fill(phone)
  await page.getByTestId("engine-save").click()
}

test("a phone edit in one window shows live in the other, and a stale save conflicts", async ({
  context,
}) => {
  const a = await context.newPage()
  const b = await context.newPage()
  await a.goto("/?persona=per_reception_farhana")
  await b.goto("/?persona=per_cashier_rafiq")
  await expect(a.getByTestId("this-window-persona")).toContainText(
    "Farhana Akter"
  )
  await expect(b.getByTestId("this-window-persona")).toContainText(
    "Rafiq Ahmed"
  )

  await openEngineCheck(a)
  const uhid = await pickAnyPatient(a)
  expect(uhid).not.toBe("")
  await openEngineCheck(b)
  await pickPatient(b, uhid)

  // Live sync: A saves, B shows the new phone and version without a reload.
  await a.getByTestId("engine-edit").click()
  await editPhone(a, "01712-345678")
  await expect(a.getByTestId("engine-saved")).toBeVisible()
  await expect(b.getByTestId("engine-phone")).toHaveText("01712-345678")
  const version = Number(
    await a.getByTestId("engine-selected").getAttribute("data-version")
  )
  await expect(b.getByTestId("engine-selected")).toHaveAttribute(
    "data-version",
    String(version)
  )

  // Isolation: both open the form at the same version; A saves first, B's save is stale.
  await a.getByTestId("engine-edit").click()
  await b.getByTestId("engine-edit").click()
  await expect(a.getByTestId("engine-editing-version")).toContainText(
    `v${version}`
  )
  await expect(b.getByTestId("engine-editing-version")).toContainText(
    `v${version}`
  )
  await editPhone(a, "01812-000111")
  await expect(a.getByTestId("engine-saved")).toContainText(`v${version + 1}`)
  await expect(b.getByTestId("engine-phone")).toHaveText("01812-000111")
  await editPhone(b, "01912-000222")
  const conflict = b.getByTestId("engine-conflict")
  await expect(conflict).toBeVisible()
  await expect(conflict).toContainText("Farhana Akter changed this record")
  await expect(conflict).toContainText(`v${version} to v${version + 1}`)
  // The stale write was refused: A's value stands in both windows.
  await expect(b.getByTestId("engine-phone")).toHaveText("01812-000111")
  await expect(a.getByTestId("engine-phone")).toHaveText("01812-000111")

  // Load latest, then B's save goes through.
  await b.getByRole("button", { name: "Load latest" }).click()
  await expect(b.getByTestId("engine-editing-version")).toContainText(
    `v${version + 1}`
  )
  await editPhone(b, "01912-000222")
  await expect(b.getByTestId("engine-saved")).toContainText(`v${version + 2}`)
  await expect(a.getByTestId("engine-phone")).toHaveText("01912-000222")

  // The event stream in A lists B's commit, labelled from the event catalog.
  await a.keyboard.press("Escape")
  await a.getByTestId("event-stream-trigger").click()
  const rows = a
    .getByTestId("event-row")
    .filter({ hasText: "Contact details updated" })
  await expect(rows).toHaveCount(3)
  await expect(rows.first()).toContainText("Rafiq Ahmed")
})
