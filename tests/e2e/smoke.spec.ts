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

test("Bangla renders when this window's language is Bangla", async ({
  page,
}) => {
  await page.goto("/?lang=bn")
  await expect(page.getByText("ডেমো শুরু করতে একটি ভূমিকা বেছে নিন")).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("lang", "bn")
  // The override is stored for this window and removed from the address.
  await expect(page).toHaveURL(/\/$/)
})

test("language is per window: a second page keeps its own setting", async ({
  context,
}) => {
  const bangla = await context.newPage()
  await bangla.goto("/?lang=bn")
  await expect(bangla.locator("html")).toHaveAttribute("lang", "bn")
  const english = await context.newPage()
  await english.goto("/")
  await expect(english.getByText("Choose a role to start the demo")).toBeVisible()
  await expect(english.locator("html")).toHaveAttribute("lang", "en")
})
