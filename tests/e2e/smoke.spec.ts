import { expect, test } from "@playwright/test"

test("launcher renders the product and prompt", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("MedCore")).toBeVisible()
  await expect(page.getByText("Choose a role to start the demo")).toBeVisible()
})

test("every stub route resolves, e.g. the pharmacy dispense screen", async ({
  page,
}) => {
  await page.goto("/pharmacy/dispense/RX-TEST")
  await expect(page.getByText("Pharmacy", { exact: true })).toBeVisible()
  await expect(page.getByText("/pharmacy/dispense/RX-TEST")).toBeVisible()
})

test("Bangla renders when the window's language is Bangla", async ({
  page,
}) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.setItem("medcore.locale", "bn"))
  await page.reload()
  await expect(
    page.getByText("ডেমো শুরু করতে একটি ভূমিকা বেছে নিন")
  ).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("lang", "bn")
})
