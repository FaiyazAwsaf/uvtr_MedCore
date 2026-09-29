import { expect, test, type Page } from "@playwright/test"

import { launchByUrl, launchFromPanel } from "./helpers"

/**
 * Front desk launchers (plan §10, P3.3): S1 duplicate patient, S11 doctor
 * delay, S16 concurrent edit. Each one's setup succeeds twice in a row, the
 * window lands on its screen with the cue card, and the key action commits.
 */

const RAFIQUL = "pat_rafiqul_islam"
const RAFIQUL_NID = "4153079826"
const SHAHNAZ = "pat_shahnaz_parvin"
const ARIF_SESSION = "ses_arif_today"

async function cue(page: Page, id: string) {
  await expect(
    page.locator(`[data-testid="cue-card"][data-scenario-id="${id}"]`)
  ).toBeVisible()
}

test("S1 from the demo panel: the prefilled form warns, Same and Different are recorded, a known NID is blocked", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/?persona=per_reception_farhana")
  for (let run = 1; run <= 2; run++) {
    await launchFromPanel(page, "S1")
    await expect(page).toHaveURL(/\/reception/)
    await cue(page, "S1")
    const sheet = page.getByTestId("register-sheet")
    await expect(sheet).toBeVisible()
    await expect(page.getByTestId("register-name-en")).toHaveValue(
      "Mohammad Rafiqul Islam"
    )
    await expect(page.getByTestId("register-dob")).toHaveValue("12-03-1978")

    await page.getByTestId("register-save").click()
    const warning = page.getByTestId("duplicate-warning")
    await expect(warning).toBeVisible()
    const existing = page.locator(
      `[data-testid="duplicate-candidate"][data-patient-id="${RAFIQUL}"]`
    )
    await expect(existing).toBeVisible()
    if (run === 1) {
      // The existing record is ranked first, with its reasons.
      await expect(
        page.getByTestId("duplicate-candidate").first()
      ).toHaveAttribute("data-patient-id", RAFIQUL)
      await existing.getByTestId("duplicate-same").click()
      await expect(sheet).toBeHidden()
      await expect(
        page.locator(
          `[data-testid="patient-panel"][data-patient-id="${RAFIQUL}"]`
        )
      ).toBeVisible()
    } else {
      await page
        .getByTestId("duplicate-reason")
        .fill("Different father's name on the NID slip")
      await page.getByTestId("duplicate-different").click()
      await expect(sheet).toBeHidden()
      await expect(page.getByTestId("patient-panel")).toBeVisible()
      await expect(page.getByTestId("patient-panel")).not.toHaveAttribute(
        "data-patient-id",
        RAFIQUL
      )
    }

    // Register again (still prefilled) with the known NID: INV-02 hard block, audited.
    await page.getByTestId("register-open").click()
    await expect(page.getByTestId("register-name-en")).toHaveValue(
      "Mohammad Rafiqul Islam"
    )
    await page.getByTestId("register-nid").fill(RAFIQUL_NID)
    await page.getByTestId("register-save").click()
    const blocked = page.locator(
      '[data-testid="rule-alert"][data-code="NID_EXISTS"]'
    )
    await expect(blocked).toBeVisible()
    await expect(blocked).toContainText("audit")
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
  }
})

test("S11 by URL: record a 45 minute delay with the SMS parts counter, apply choices, and Tanvir chooses in the app", async ({
  page,
  context,
}) => {
  test.setTimeout(150_000)
  for (let run = 1; run <= 2; run++) {
    await launchByUrl(
      page,
      "S11",
      "/reception/delays?persona=per_reception_farhana"
    )
    await expect(page).toHaveURL(
      new RegExp(`/reception/delays\\?session=${ARIF_SESSION}`)
    )
    const card = page.locator(
      `[data-testid="delay-card"][data-session-id="${ARIF_SESSION}"]`
    )
    await expect(card).toHaveAttribute("data-status", "open")

    await page.getByTestId("delay-record").click()
    await page
      .locator('[data-testid="delay-preset"][data-minutes="45"]')
      .click()
    await expect(page.getByTestId("delay-minutes")).toHaveValue("45")
    await page.getByTestId("delay-reason").selectOption("traffic")
    const parts = page.getByTestId("delay-sms-parts")
    await expect(parts).toBeVisible()
    expect(
      Number(await parts.getAttribute("data-total-parts"))
    ).toBeGreaterThan(0)
    // Bangla (UCS-2) needs more parts than English for the same notice.
    expect(Number(await parts.getAttribute("data-bn-parts"))).toBeGreaterThan(
      Number(await parts.getAttribute("data-en-parts"))
    )
    await page.getByTestId("delay-send").click()
    await expect(card).toHaveAttribute("data-status", "delayed")
    await expect(card).toHaveAttribute("data-delay", "45")

    // Choices at the desk: the first waiting booking waits, the next one is rebooked.
    const waitButton = page
      .locator('[data-testid="delay-choice"][data-choice="wait"]')
      .first()
    const waitId = await waitButton.getAttribute("data-appointment-id")
    await waitButton.click()
    await expect(
      page.locator(
        `[data-testid="delay-booking"][data-appointment-id="${waitId}"]`
      )
    ).toHaveAttribute("data-choice", "wait")
    const rebook = page
      .locator('[data-testid="delay-choice"][data-choice="rebook"]')
      .first()
    const rebookId = await rebook.getAttribute("data-appointment-id")
    await rebook.click()
    await expect(
      page.locator(
        `[data-testid="delay-booking"][data-appointment-id="${rebookId}"]`
      )
    ).toHaveAttribute("data-status", "rebooked")

    if (run === 1) {
      // Tanvir sees the delay on his appointment and answers in the app.
      const app = await context.newPage()
      await app.goto("/app?persona=per_patient_tanvir")
      await app.getByTestId("app-lang-en").click()
      await app.getByTestId("app-otp-send").click()
      await app.getByTestId("app-otp-code").fill("123456")
      await app.getByTestId("app-otp-verify").click()
      await app.goto("/app/appointments")
      const notice = app.getByTestId("app-delay")
      await expect(notice).toBeVisible()
      await expect(notice).toContainText("45 minutes late")
      await notice
        .locator('[data-testid="app-delay-choice"][data-choice="wait"]')
        .click()
      await expect(notice).toHaveAttribute("data-choice", "wait")
      const appointmentId = await notice.getAttribute("data-appointment-id")
      // The desk sees his answer live.
      await expect(
        page.locator(
          `[data-testid="delay-booking"][data-appointment-id="${appointmentId}"]`
        )
      ).toHaveAttribute("data-choice", "wait")
      await app.close()
    }
  }
})

test("S16 in two windows: the second save hits the conflict dialog naming who changed it, then re-applies", async ({
  context,
}) => {
  test.setTimeout(150_000)
  const pane1 = await context.newPage()
  const pane2 = await context.newPage()
  for (let run = 1; run <= 2; run++) {
    for (const pane of [pane1, pane2]) {
      await launchByUrl(pane, "S16", "/reception?persona=per_reception_farhana")
      await expect(
        pane.locator(
          `[data-testid="patient-panel"][data-patient-id="${SHAHNAZ}"]`
        )
      ).toBeVisible()
      await expect(pane.getByTestId("contact-form")).toBeVisible()
    }
    const opened = await pane2
      .getByTestId("contact-form")
      .getAttribute("data-version")

    await pane1.getByTestId("contact-phone").fill(`01712-00${run}111`)
    await pane1.getByTestId("contact-save").click()
    await expect(pane1.getByTestId("contact-form")).toBeHidden()

    await pane2.getByTestId("contact-phone").fill(`01712-00${run}222`)
    await pane2.getByTestId("contact-save").click()
    const dialog = pane2.getByRole("dialog", {
      name: "This record was changed",
    })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("Record changed by Farhana Akter")
    await expect(dialog).toContainText(`v${opened} to v${Number(opened) + 1}`)
    await dialog.getByRole("button", { name: "Reload" }).click()
    await expect(dialog).toHaveCount(0)

    // The form now holds the latest version: re-apply and save.
    await expect(pane2.getByTestId("contact-reloaded")).toBeVisible()
    await expect(pane2.getByTestId("contact-form")).toHaveAttribute(
      "data-version",
      String(Number(opened) + 1)
    )
    await pane2.getByTestId("contact-phone").fill(`01712-00${run}222`)
    await pane2.getByTestId("contact-save").click()
    await expect(pane2.getByTestId("contact-form")).toBeHidden()
    await expect(pane1.getByTestId("patient-panel")).toContainText(
      `01712-00${run}222`
    )
  }
})
