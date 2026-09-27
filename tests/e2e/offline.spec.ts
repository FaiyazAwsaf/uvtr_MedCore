import { expect, test, type Page } from "@playwright/test"

/**
 * Checkpoint 1, item 6 (plan §3.7): cutting Branch 1's internet moves its
 * windows onto the branch edge store. Work done there is invisible to central
 * windows and queued; reconnect replays it, and central sees it live.
 */

async function openPanelTab(page: Page, tab: string) {
  const panel = page.getByTestId("demo-panel")
  if (!(await panel.isVisible())) {
    await page.getByTestId("demo-panel-trigger").click()
  }
  await page.getByRole("tab", { name: tab }).click()
}

async function selectPatient(page: Page, uhid: string) {
  await openPanelTab(page, "Engine check")
  const selected = page.getByTestId("engine-selected-uhid")
  const search = page.getByTestId("engine-search")
  // The panel renders from a live query: wait for either state before deciding.
  await expect(selected.or(search)).toBeVisible()
  if ((await selected.isVisible()) && (await selected.textContent())?.trim() === uhid) return
  if (await selected.isVisible()) {
    await page.getByRole("button", { name: "Change patient" }).click()
  }
  await search.fill(uhid)
  await page.getByTestId("engine-patient-row").first().click()
  await expect(selected).toHaveText(uhid)
}

test("an offline branch keeps working unseen by central, then resyncs on reconnect", async ({
  context,
}) => {
  const branch = await context.newPage()
  const hq = await context.newPage()
  await branch.goto("/?persona=per_reception_farhana")
  await hq.goto("/?persona=per_ceo_anwar")
  await expect(branch.getByTestId("this-window-persona")).toContainText("Farhana Akter")
  await expect(hq.getByTestId("this-window-persona")).toContainText("Anwar Hossain")

  // Pick the same patient in both windows.
  await openPanelTab(branch, "Engine check")
  await branch.getByTestId("engine-patient-row").first().click()
  const uhid = ((await branch.getByTestId("engine-selected-uhid").textContent()) ?? "").trim()
  expect(uhid).not.toBe("")
  const phoneBefore = ((await branch.getByTestId("engine-phone").textContent()) ?? "").trim()
  await selectPatient(hq, uhid)

  // Cut B1 from the HQ window: every B1 window switches to its branch server.
  await openPanelTab(hq, "Clock and network")
  await hq.getByTestId("network-cut-B1").click()
  await expect(hq.getByTestId("network-B1")).toHaveAttribute("data-status", "offline")

  // B1 keeps working offline.
  await selectPatient(branch, uhid)
  await branch.getByTestId("engine-edit").click()
  await branch.getByTestId("engine-phone-input").fill("01799-000777")
  await branch.getByTestId("engine-save").click()
  await expect(branch.getByTestId("engine-saved")).toBeVisible()
  await expect(branch.getByTestId("engine-phone")).toHaveText("01799-000777")

  // Central cannot see it; the change waits in B1's queue.
  await expect(hq.getByTestId("network-B1")).toContainText("1 queued")
  await selectPatient(hq, uhid)
  await hq.waitForTimeout(800)
  await expect(hq.getByTestId("engine-phone")).toHaveText(phoneBefore)

  // Reconnect: the queue replays onto central, which updates live.
  await openPanelTab(hq, "Clock and network")
  await hq.getByTestId("network-reconnect-B1").click()
  await expect(hq.getByTestId("network-B1")).toHaveAttribute("data-status", "online")
  await selectPatient(hq, uhid)
  await expect(hq.getByTestId("engine-phone")).toHaveText("01799-000777")

  // The replayed change keeps its branch origin in the event stream.
  await hq.keyboard.press("Escape")
  await hq.getByTestId("event-stream-trigger").click()
  await expect(
    hq.getByTestId("event-row").filter({ hasText: "offline events replayed from B1" })
  ).toHaveCount(1)
})
