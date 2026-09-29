import { expect, test, type BrowserContext, type Page } from "@playwright/test"

/**
 * P2.9: the Karim story end to end. One browser context (so every page shares
 * the same IndexedDB), one page per persona, and every hand-off is asserted
 * live in the next window without a reload: reception books and checks in
 * Abdul, the display board and the doctor's worklist pick him up, the doctor
 * consults, prescribes and orders, the cashier takes bKash plus cash, the lab
 * runs CBC and CRP, the pathologist signs, the doctor's inbox and the
 * pharmacy queue update, the pharmacist dispenses, the follow-up is booked
 * with its reminder SMS (no clinical content), and Tanvir sees his father's
 * report and prescription in the patient app.
 */

const ABDUL = "pat_abdul_karim"
const KAMAL = "doc_kamal_hossain"
const PHONE = "01711-523418"
/** Second identifier at the lab and pharmacy: the last four digits of his phone */
const PHONE_TAIL = "3418"

async function openAs(context: BrowserContext, path: string, persona: string) {
  const page = await context.newPage()
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}persona=${persona}`)
  return page
}

/** Search the Rx pad and pick one brand from the results. */
async function pickBrand(doctor: Page, query: string, brandId: string) {
  await doctor.getByTestId("rx-search").fill(query)
  await doctor
    .locator(`[data-testid="rx-option"][data-brand-id="${brandId}"]`)
    .click()
  await expect(
    doctor.locator(`[data-testid="rx-pick"][data-brand-id="${brandId}"]`)
  ).toBeVisible()
}

async function addLine(doctor: Page, brandId: string, dose: string) {
  await doctor.getByTestId("rx-dose").fill(dose)
  await doctor.getByTestId("rx-duration").fill("5")
  await doctor.getByTestId("rx-add").click()
  await expect(
    doctor.locator(`[data-testid="rx-line"][data-brand-id="${brandId}"]`)
  ).toBeVisible()
}

test("the Karim journey runs across every window with live hand-offs", async ({
  context,
}) => {
  test.setTimeout(300_000)

  // The first page seeds the demo; the others open onto the same data.
  const reception = await openAs(context, "/reception", "per_reception_farhana")
  await expect(reception.getByTestId("reception-search")).toBeVisible()
  const display = await context.newPage()
  await display.goto("/display/B1")
  await expect(display.getByTestId("display-board")).toBeVisible()
  const doctor = await openAs(context, "/doctor", "per_doctor_kamal")
  await expect(doctor.getByTestId("doctor-worklist")).toBeVisible()
  const abdulRow = doctor.locator(
    `[data-testid="worklist-row"][data-patient-id="${ABDUL}"]`
  )
  await expect(abdulRow).toHaveCount(0)

  let token = ""
  await test.step("reception finds Abdul by the family phone, books Dr. Kamal and checks him in", async () => {
    await reception.getByTestId("reception-search").fill(PHONE)
    await reception
      .locator(`[data-testid="household-member"][data-patient-id="${ABDUL}"]`)
      .click()
    await expect(
      reception.locator(
        `[data-testid="patient-panel"][data-patient-id="${ABDUL}"]`
      )
    ).toBeVisible()
    await reception.getByTestId("patient-book").click()
    await reception
      .locator(`[data-testid="book-doctor"][data-doctor-id="${KAMAL}"]`)
      .click()
    await reception
      .locator('[data-testid="book-slot"][data-state="free"]')
      .first()
      .click()
    await reception.getByTestId("book-confirm").click()
    await expect(reception.getByTestId("book-success")).toBeVisible()
    await reception.getByTestId("book-checkin").click()
    await expect(reception.getByTestId("book-token")).toHaveText(/^M-\d+$/)
    token = (await reception.getByTestId("book-token").textContent())!.trim()
  })

  await test.step("the doctor's worklist shows him live and starting the consult puts him on the board", async () => {
    await expect(abdulRow).toHaveAttribute("data-status", "waiting")
    await abdulRow.getByTestId("worklist-start").click()
    await expect(
      doctor.locator(
        `[data-testid="encounter-page"][data-patient-id="${ABDUL}"]`
      )
    ).toBeVisible()
    await expect(display.getByTestId("display-board")).toContainText(token)
    await display.close()
    await reception.close()
  })

  // Open the downstream windows now so their live updates can be asserted.
  const pharmacy = await openAs(context, "/pharmacy", "per_pharmacist_shirin")
  const cashier = await openAs(context, "/cashier", "per_cashier_rafiq")
  await expect(
    cashier.locator('[data-testid="cashier-shift"][data-status="open"]')
  ).toBeVisible()

  let rxNo = ""
  await test.step("the doctor scribes, signs the note, meets the allergy and stock alerts, orders tests and signs the Rx", async () => {
    await doctor.getByTestId("scribe-record").click()
    await doctor.getByTestId("scribe-skip").click()
    await expect(
      doctor.locator('[data-testid="scribe-panel"][data-state="drafted"]')
    ).toBeVisible()
    await doctor.getByTestId("scribe-accept").click()
    await expect(doctor.getByTestId("note-section-chiefComplaint")).toHaveValue(
      /Fever for 5 days/
    )
    await doctor.getByTestId("note-sign").click()
    await expect(
      doctor.locator('[data-testid="note-status"][data-status="signed"]')
    ).toBeVisible()

    // Penicillin allergy: Moxacil (amoxicillin) is blocked until a reason is given.
    await pickBrand(doctor, "Moxacil 500", "brd_moxacil_500mg")
    await expect(
      doctor.locator('[data-testid="rx-alert"][data-kind="allergy"]')
    ).toBeVisible()
    await expect(doctor.getByTestId("rx-add")).toBeDisabled()
    await doctor.getByTestId("rx-pick-clear").click()

    // Zimax is out at B1 and in stock at B3: take the same-strength alternative.
    await pickBrand(doctor, "Zimax 500", "brd_zimax_500mg")
    await expect(doctor.getByTestId("rx-stock-badge")).toHaveAttribute(
      "data-status",
      "other-branch"
    )
    await expect(
      doctor.locator('[data-testid="rx-stock-other"][data-branch="B3"]')
    ).toBeVisible()
    await doctor
      .locator(
        '[data-testid="rx-alternative"][data-brand-id="brd_azithrocin_500mg"]'
      )
      .click()
    await expect(
      doctor.locator(
        '[data-testid="rx-pick"][data-brand-id="brd_azithrocin_500mg"]'
      )
    ).toBeVisible()
    await addLine(doctor, "brd_azithrocin_500mg", "1+0+0")

    await pickBrand(doctor, "Ace 500", "brd_ace_500mg")
    await addLine(doctor, "brd_ace_500mg", "1+0+1")
    const ace = doctor.locator(
      '[data-testid="rx-line"][data-brand-id="brd_ace_500mg"]'
    )
    await expect(ace).toHaveAttribute("data-dose", "1+0+1")
    await expect(ace).toHaveAttribute("data-qty", "10")
    await expect(ace.getByTestId("rx-line-bn")).toContainText("১+০+১")

    for (const code of ["CBC", "CRP", "XR-CHEST"]) {
      await doctor
        .locator(`[data-testid="order-quick"][data-test-code="${code}"]`)
        .click()
    }
    await doctor.getByTestId("orders-place").click()
    await expect(
      doctor.locator('[data-testid="order-placed"][data-status="ordered"]')
    ).toHaveCount(3)

    // Review in two weeks: signing sends the follow-up reminder SMS.
    await doctor
      .locator('[data-testid="rx-follow-up-chip"][data-days="14"]')
      .click()
    await expect(doctor.getByTestId("rx-follow-up")).not.toHaveValue("")

    await doctor.getByTestId("rx-sign").click()
    await expect(
      doctor.locator('[data-testid="rx-status"][data-status="signed"]')
    ).toBeVisible()
    rxNo = (await doctor.getByTestId("rx-number").textContent())!.trim()
    expect(rxNo).toMatch(/^RX-B1-\d+$/)

    await doctor.getByTestId("rx-book-follow-up").click()
    await doctor
      .getByTestId("follow-up-book")
      .and(doctor.locator(":enabled"))
      .first()
      .click()
    await expect(doctor.getByTestId("rx-follow-up-booked")).toBeVisible()
  })

  await test.step("the signed Rx reaches the pharmacy queue live and the doctor finishes", async () => {
    await expect(
      pharmacy.getByTestId("pharmacy-queue-row").filter({ hasText: rxNo })
    ).toBeVisible()
    await doctor.getByTestId("consult-finish").click()
    await expect(doctor).toHaveURL(/\/doctor$/)
    await expect(abdulRow).toHaveAttribute("data-status", "done")
  })

  const lab = await openAs(context, "/lab", "per_labtech_rubel")
  await expect(
    lab.getByTestId("collect-row").filter({ hasText: "Abdul Karim" })
  ).toHaveCount(0)

  await test.step("the cashier bills consult, tests, X-ray and medicines, split bKash and cash", async () => {
    await cashier
      .locator(`[data-testid="cashier-open-bill"][data-patient-id="${ABDUL}"]`)
      .click()
    await expect(
      cashier.locator(
        `[data-testid="cashier-patient"][data-patient-id="${ABDUL}"]`
      )
    ).toBeVisible()
    const lines = cashier.getByTestId("basket-line")
    // Today's fee is ticked; the follow-up fee waits for that visit.
    const consults = lines.and(cashier.locator('[data-source-type="consult"]'))
    await expect(consults).toHaveCount(2)
    await expect(
      consults.and(cashier.locator('[data-selected="true"]'))
    ).toHaveCount(1)
    await expect(
      consults.and(cashier.locator("[data-later-visit]"))
    ).toHaveAttribute("data-selected", "false")
    await expect(
      lines.and(cashier.locator('[data-source-type="test"]'))
    ).toHaveCount(2)
    await expect(
      lines.and(cashier.locator('[data-source-type="imaging"]'))
    ).toHaveCount(1)
    await expect(
      lines.and(cashier.locator('[data-source-type="rx-line"]'))
    ).toHaveCount(2)

    await cashier
      .locator('[data-testid="tender-add"][data-tender="bkash"]')
      .click()
    await cashier
      .locator('[data-testid="tender-amount"][data-tender="bkash"]')
      .fill("1000")
    await cashier
      .locator('[data-testid="tender-add"][data-tender="cash"]')
      .click()
    await expect(cashier.getByTestId("tender-balance")).toHaveAttribute(
      "data-left",
      "0"
    )
    await cashier.getByTestId("cashier-pay").click()
    await expect(
      cashier.locator('[data-testid="mfs-pending"][data-tender="bkash"]')
    ).toBeVisible()

    // Nothing reaches the lab while bKash is waiting for the customer.
    await expect(
      lab.getByTestId("collect-row").filter({ hasText: "Abdul Karim" })
    ).toHaveCount(0)
    await cashier.getByTestId("mfs-approve").click()
    await expect(cashier.getByTestId("payment-done")).toBeVisible()
    await expect(cashier.getByTestId("receipt-no")).toHaveText(/RC-B1-\d+/)
    await cashier.close()
  })

  await test.step("the lab collects, receives, runs and validates CBC and CRP", async () => {
    const rows = lab
      .getByTestId("collect-row")
      .filter({ hasText: "Abdul Karim" })
    await expect(rows).toHaveCount(2)
    const specimens: string[] = []
    for (const row of await rows.all())
      specimens.push((await row.getAttribute("data-specimen-id"))!)

    for (const id of specimens) {
      await lab
        .locator(`[data-testid="collect-row"][data-specimen-id="${id}"]`)
        .click()
      await lab.getByTestId("collect-verify").fill(PHONE_TAIL)
      await lab.getByTestId("collect-confirm").click()
      await expect(lab.getByTestId("collect-dialog")).toBeHidden()
    }

    await lab.goto("/lab/reception")
    for (const id of specimens) {
      const row = lab.locator(
        `[data-testid="receive-row"][data-specimen-id="${id}"]`
      )
      await row.getByTestId("receive-confirm").click()
      await expect(row).toHaveCount(0)
    }

    await lab.goto("/lab/analyser")
    for (const id of specimens) {
      await lab
        .locator(`[data-testid="analyser-run"][data-specimen-id="${id}"]`)
        .click()
    }
    await expect(
      lab.getByTestId("resulted-item").filter({ hasText: "Abdul Karim" })
    ).toHaveCount(2)

    await lab.goto("/lab/validation")
    const pending = lab
      .getByTestId("validate-row")
      .filter({ hasText: "Abdul Karim" })
    await expect(pending).toHaveCount(2)
    const items: string[] = []
    for (const row of await pending.all())
      items.push((await row.getAttribute("data-item-id"))!)
    for (const id of items) {
      await lab
        .locator(`[data-testid="validate-row"][data-item-id="${id}"]`)
        .click()
      await lab
        .locator(`[data-testid="validation-detail"][data-item-id="${id}"]`)
        .getByTestId("validate-confirm")
        .click()
      await expect(
        lab.locator(`[data-testid="validate-row"][data-item-id="${id}"]`)
      ).toHaveCount(0)
    }
    await lab.close()
  })

  await test.step("the pathologist signs and the report lands in the doctor's inbox live", async () => {
    await doctor.goto("/doctor/inbox")
    const inbox = doctor
      .locator(
        '[data-testid="inbox-item"][data-kind="abnormal"][data-status="unread"]'
      )
      .filter({ hasText: "Abdul Karim" })
    await expect(inbox).toHaveCount(0)

    const pathology = await openAs(
      context,
      "/pathology",
      "per_pathologist_mizanur"
    )
    await pathology
      .locator('[data-testid="signoff-row"][data-kind="ready"]')
      .filter({ hasText: "Abdul Karim" })
      .click()
    await pathology.getByTestId("signoff-sign").click()
    await expect(inbox).toHaveCount(1)
    await pathology.close()
  })

  await test.step("the pharmacist verifies Abdul and dispenses with Bangla labels", async () => {
    await pharmacy
      .getByTestId("pharmacy-queue-row")
      .filter({ hasText: rxNo })
      .click()
    await expect(pharmacy.getByTestId("dispense-screen")).toBeVisible()
    await pharmacy.getByTestId("dispense-verify").fill(PHONE_TAIL)
    await expect(pharmacy.getByTestId("dispense-verified")).toBeVisible()
    await expect(pharmacy.getByTestId("dispense-line")).toHaveCount(2)
    for (const box of await pharmacy.getByTestId("dispense-select").all()) {
      await expect(box).toBeChecked()
    }
    await pharmacy.getByTestId("dispense-confirm").click()
    await expect(pharmacy.getByTestId("label-preview")).toHaveCount(2)
    await expect(
      pharmacy.locator('[data-testid="dispense-line"][data-status="dispensed"]')
    ).toHaveCount(2)
  })

  await test.step("Tanvir signs in to the patient app and sees his father's report and prescription", async () => {
    const app = await openAs(context, "/app", "per_patient_tanvir")
    await app.getByTestId("app-lang-en").click()
    await app.getByTestId("app-otp-send").click()
    await app.getByTestId("app-otp-code").fill("123456")
    await app.getByTestId("app-otp-verify").click()
    await app.getByTestId("app-family-switch").click()
    await app
      .locator(`[data-testid="app-family-member"][data-patient-id="${ABDUL}"]`)
      .click()
    await expect(
      app.locator(
        `[data-testid="app-family-switch"][data-patient-id="${ABDUL}"]`
      )
    ).toBeVisible()
    await expect(app.getByTestId("app-home-report")).toBeVisible()

    await app.goto("/app/prescriptions")
    const rx = app.locator(`[data-testid="app-rx"][data-rx-no="${rxNo}"]`)
    await expect(rx).toHaveAttribute("data-summary", "all")

    // Every SMS to Abdul today is free of clinical content, and the
    // follow-up reminder is among them.
    const sms = await app.evaluate(
      (patientId) =>
        new Promise<{ templateId: string; text: string }[]>(
          (resolve, reject) => {
            const open = indexedDB.open("medcore-central")
            open.onerror = () => reject(open.error)
            open.onsuccess = () => {
              const all = open.result
                .transaction("sms")
                .objectStore("sms")
                .getAll()
              all.onsuccess = () =>
                resolve(
                  (
                    all.result as {
                      patientId?: string
                      templateId: string
                      text: string
                    }[]
                  ).filter((row) => row.patientId === patientId)
                )
            }
          }
        ),
      ABDUL
    )
    expect(sms.map((row) => row.templateId)).toContain("follow-up-reminder")
    for (const row of sms) {
      expect(row.text).not.toMatch(
        /\b(Azithrocin|Ace 500|CBC|CRP|X-ray|leukocyt)/i
      )
    }

    await app.goto("/app/reports")
    const report = app
      .locator('[data-testid="app-report"][data-status="released"]')
      .first()
    await expect(
      report.locator('[data-testid="app-report-result"][data-flag="H"]').first()
    ).toBeVisible()
  })
})
