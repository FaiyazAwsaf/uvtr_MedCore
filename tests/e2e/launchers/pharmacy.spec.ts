import { expect, test, type Page } from "@playwright/test"

import { launchByUrl, launchFromPanel } from "./helpers"

/**
 * S3 and S4 launchers (plan §10, P3.3): each one is launched twice in a row,
 * lands on the pharmacist's dispense screen with its cue card, and the
 * presenter's key action commits every time. S4 is played across two
 * windows: the pharmacist asks, Dr. Kamal approves in his inbox, and version 2
 * reaches the pharmacist live, then is paid at the cashier and dispensed.
 */

const TANVIR = "pat_tanvir_karim"
/** Tanvir's second identifier: the last four digits of the family phone */
const PHONE_TAIL = "3418"

/** One committed row from the browser's central store. */
async function row<T>(page: Page, store: string, id: string): Promise<T> {
  return page.evaluate(
    ([name, key]) =>
      new Promise<T>((resolve, reject) => {
        const open = indexedDB.open("medcore-central")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const get = open.result.transaction(name).objectStore(name).get(key)
          get.onsuccess = () => resolve(get.result as T)
          get.onerror = () => reject(get.error)
        }
      }),
    [store, id] as const
  )
}

/** The prescription the dispense screen shows (the one in the address). */
async function dispenseTarget(page: Page) {
  await expect(page).toHaveURL(/\/pharmacy\/dispense\/[^/?]+$/)
  const rxId = decodeURIComponent(
    new URL(page.url()).pathname.split("/").pop()!
  )
  const screen = page.locator(
    `[data-testid="dispense-screen"][data-rx-id="${rxId}"]`
  )
  await expect(screen).toBeVisible()
  const rxNo = (await screen.getAttribute("data-rx-no"))!
  expect(rxNo).toMatch(/^RX-B1-\d{6}$/)
  return { rxId, rxNo, screen }
}

test("S3 from the demo panel: 14 of 28 dispensed, the balance on the label and in Tanvir's app, twice", async ({
  page,
  context,
}) => {
  await page.goto("/?persona=per_pharmacist_shirin")
  const rxNos: string[] = []
  for (let run = 0; run < 2; run++) {
    await launchFromPanel(page, "S3")
    const { rxNo } = await dispenseTarget(page)
    rxNos.push(rxNo)
    const cue = page.locator('[data-testid="cue-card"][data-scenario-id="S3"]')
    await expect(cue).toContainText(rxNo)

    const line = page.getByTestId("dispense-line")
    await expect(line).toHaveCount(1)
    await expect(line).toHaveAttribute("data-status", "open")
    // Only 14 of 28 are on the shelf: that is what the screen offers.
    await expect(page.getByTestId("dispense-qty")).toHaveValue("14")

    await page.getByTestId("dispense-verify").fill(PHONE_TAIL)
    await expect(page.getByTestId("dispense-verified")).toBeVisible()
    await page.getByTestId("dispense-confirm").click()
    await expect(line).toHaveAttribute("data-status", "partial")
    await expect(line).toContainText("Balance open until")

    const label = page.getByTestId("label-preview").first()
    await expect(label).toBeVisible()
    await page
      .getByTestId("dispense-labels")
      .getByText("English", { exact: true })
      .click()
    await expect(label).toContainText("Given: 14 capsules")
    await expect(label).toContainText("Still to collect: 14 capsules")
  }
  expect(new Set(rxNos).size).toBe(2)

  // Tanvir's own patient app shows what is still to collect, with no reload needed.
  const app = await context.newPage()
  await app.goto("/app?persona=per_patient_tanvir")
  await app.getByTestId("app-lang-en").click()
  await app.getByTestId("app-otp-send").click()
  await app.getByTestId("app-otp-code").fill("123456")
  await app.getByTestId("app-otp-verify").click()
  await expect(
    app.locator(
      `[data-testid="app-family-switch"][data-patient-id="${TANVIR}"]`
    )
  ).toBeVisible()
  await app.goto("/app/prescriptions")
  for (const rxNo of rxNos) {
    const rx = app.locator(`[data-testid="app-rx"][data-rx-no="${rxNo}"]`)
    await expect(rx).toHaveAttribute("data-summary", "balance")
    await expect(
      rx.locator('[data-testid="app-rx-line"][data-outstanding="14"]')
    ).toBeVisible()
    await expect(rx.getByTestId("app-rx-balance")).toHaveAttribute(
      "data-expired",
      "false"
    )
  }
})

test("S4 by URL then from the panel: substitute requested, approved in the doctor's window, version 2 paid and dispensed, twice", async ({
  page,
  context,
}) => {
  const doctor = await context.newPage()
  const cashier = await context.newPage()
  for (let run = 0; run < 2; run++) {
    if (run === 0) {
      await launchByUrl(page, "S4", "/pharmacy?persona=per_pharmacist_shirin")
    } else {
      await launchFromPanel(page, "S4")
    }
    const { rxId, rxNo } = await dispenseTarget(page)
    await expect(
      page.locator('[data-testid="cue-card"][data-scenario-id="S4"]')
    ).toContainText(rxNo)

    // The Monas line: out at Dhanmondi, nothing billed, open for a request.
    const monas = page
      .getByTestId("dispense-line")
      .filter({ hasText: "Monas 10 mg" })
    await expect(monas).toHaveAttribute("data-status", "open")
    await monas.getByTestId("substitution-request").click()
    const options = page.getByTestId("substitution-option")
    // Same generic and strength only, A to Z, with this branch's stock.
    await expect(options).toHaveCount(2)
    await expect(options.nth(0)).toHaveAttribute(
      "data-brand-id",
      "brd_lumona_10mg"
    )
    await expect(options.nth(1)).toHaveAttribute(
      "data-brand-id",
      "brd_montair_10mg"
    )
    await options.nth(0).click()
    await page
      .getByTestId("substitution-reason")
      .fill("Out of stock at Dhanmondi")
    await page.getByTestId("substitution-send").click()
    await expect(monas).toHaveAttribute("data-status", "awaiting-prescriber")

    // Doctor window: the request names the Rx and both brands; Dr. Kamal approves.
    if (run === 0) await doctor.goto("/doctor/inbox?persona=per_doctor_kamal")
    const item = doctor
      .locator('[data-testid="inbox-item"][data-kind="substitution"]')
      .filter({ hasText: rxNo })
    await expect(item).toContainText("Monas 10 mg")
    await expect(item).toContainText("Lumona 10 mg")
    await item.getByTestId("substitution-approve").click()
    await expect(item.getByTestId("substitution-decision")).toHaveAttribute(
      "data-status",
      "approved"
    )

    // Pharmacist window: version 2 arrives live.
    await expect(page.getByTestId("dispense-superseded")).toBeVisible()
    await page.getByTestId("dispense-open-current").click()
    await expect(page).not.toHaveURL(new RegExp(`${rxId}$`))
    const v2 = await dispenseTarget(page)
    expect(v2.rxNo).toBe(rxNo)
    await expect(v2.screen).toHaveAttribute("data-rx-version", "2")
    await expect(v2.screen).toContainText("v2")
    const lumona = page
      .getByTestId("dispense-line")
      .filter({ hasText: "Lumona 10 mg" })
    await expect(lumona).toHaveAttribute("data-status", "open")
    await expect(lumona).toContainText("Awaiting payment")

    // The cashier takes payment for the new brand.
    const rx = await row<{ patientId: string }>(page, "prescriptions", v2.rxId)
    if (run === 0) await cashier.goto("/cashier?persona=per_cashier_nasrin")
    else await cashier.goto("/cashier")
    await cashier
      .locator(
        `[data-testid="cashier-open-bill"][data-patient-id="${rx.patientId}"]`
      )
      .click()
    await expect(
      cashier
        .getByTestId("basket-line")
        .and(cashier.locator('[data-source-type="rx-line"]'))
        .filter({ hasText: "Lumona 10 mg" })
    ).toHaveAttribute("data-selected", "true")
    await cashier
      .locator('[data-testid="tender-add"][data-tender="cash"]')
      .click()
    await expect(cashier.getByTestId("tender-balance")).toHaveAttribute(
      "data-left",
      "0"
    )
    await cashier.getByTestId("cashier-pay").click()
    await expect(cashier.getByTestId("payment-done")).toBeVisible()

    // Pharmacist: both lines are paid now; confirm identity and dispense version 2.
    await expect(lumona).toContainText("Paid")
    const patient = await row<{ dob: string }>(page, "patients", rx.patientId)
    await page.getByTestId("dispense-verify").fill(patient.dob)
    await expect(page.getByTestId("dispense-verified")).toBeVisible()
    await page.getByTestId("dispense-confirm").click()
    await expect(
      page.locator('[data-testid="dispense-line"][data-status="dispensed"]')
    ).toHaveCount(2)

    // The queue shows the prescription as version 2, settled.
    await v2.screen.getByRole("link", { name: "Rx queue" }).click()
    const queueRow = page.locator(
      `[data-testid="pharmacy-queue-row"][data-rx-id="${v2.rxId}"]`
    )
    await expect(queueRow).toHaveAttribute("data-rx-version", "2")
    await expect(queueRow).toHaveAttribute("data-status", "done")
  }
})
