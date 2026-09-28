import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { rules } from "@/config/rules.config"
import type { MedcoreDb } from "@/core/db/database"
import type { CorporateEmployeeRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { checkout } from "@/modules/billing/commands"

import { expectBalanced, heroBasket, RAFIQ, resetClock, seededDb } from "./fixtures"

let db: MedcoreDb
let employees: CorporateEmployeeRow[]

beforeAll(async () => {
  db = await seededDb("billing-corporate")
  const active = await db.corporateEmployees.where("status").equals("active").toArray()
  employees = []
  for (const employee of active) {
    if (!employee.patientId) continue
    const contract = await db.corporateContracts.get(employee.contractId)
    const patient = await db.patients.get(employee.patientId)
    if (contract?.status === "active" && patient?.corporateEmployeeId === employee.id) {
      employees.push(employee)
    }
  }
})
afterAll(async () => {
  resetClock()
  await db.delete()
})

/** The hero-style basket for an employee, with the consultation and tests billed to the company. */
async function corporateBasket(employee: CorporateEmployeeRow) {
  const basket = await heroBasket(db, employee.patientId!, { viaBooking: false })
  const corporateIds = [basket.consultLineId, ...basket.lineIds.filter((id) => id.includes("_lt_"))]
  for (const id of corporateIds) {
    await db.basketLines.update(id, { payerType: "corporate", corporateClientId: employee.clientId })
  }
  const lines = (await db.basketLines.bulkGet(basket.lineIds)).map((line) => line!)
  const corporateNetP = lines
    .filter((line) => corporateIds.includes(line.id))
    .reduce((sum, line) => sum + line.qty * line.unitPriceP, 0)
  return { basket, corporateNetP }
}

describe("corporate cover (PRD §10.10)", () => {
  it("the company pays all but the co-pay; the patient pays the co-pay and self-pay lines at the counter", async () => {
    const employee = employees[0]
    const { basket, corporateNetP } = await corporateBasket(employee)
    const coPayP = Math.round((corporateNetP * rules.corporate.coPayPct) / 100)
    const companyP = corporateNetP - coPayP
    const dueP = basket.totalP - companyP

    const { result } = await commit(
      checkout,
      {
        patientId: basket.patientId,
        basketLineIds: basket.lineIds,
        tenders: [{ tender: "cash", amountP: dueP }],
        idempotencyKey: "corporate-0001",
      },
      { db, actor: RAFIQ }
    )
    expect(result).toMatchObject({ status: "paid", corporateShareP: companyP, patientDueP: dueP })

    const invoice = (await db.invoices.get(result.invoiceId))!
    expect(invoice).toMatchObject({ payerType: "corporate", corporateClientId: employee.clientId })
    const payments = await db.payments.where("invoiceId").equals(result.invoiceId).toArray()
    expect(payments.map((p) => [p.tender, p.amountP, p.status]).sort()).toEqual(
      [
        ["cash", dueP, "confirmed"],
        ["corporate", companyP, "confirmed"],
      ].sort()
    )
    await expectBalanced(db, result.invoiceId)

    const after = (await db.corporateEmployees.get(employee.id))!
    expect(after.usedP).toBe(employee.usedP + companyP)
    // The receipt is for what the patient paid.
    const receipt = (await db.receipts.where("invoiceId").equals(result.invoiceId).first())!
    expect(receipt.amountP).toBe(dueP)
    // Settled: the lab is unlocked.
    const items = await db.labOrderItems.bulkGet(basket.labItemIds)
    expect(items.every((item) => item!.paymentCleared)).toBe(true)
  })

  it("the company's share stops at the employee's annual limit", async () => {
    const employee = employees[1]
    const contract = (await db.corporateContracts.get(employee.contractId))!
    const leftP = 100_00
    await db.corporateEmployees.update(employee.id, { usedP: contract.annualLimitP - leftP })
    const { basket } = await corporateBasket(employee)
    const dueP = basket.totalP - leftP
    const { result } = await commit(
      checkout,
      {
        patientId: basket.patientId,
        basketLineIds: basket.lineIds,
        tenders: [{ tender: "cash", amountP: dueP }],
        idempotencyKey: "corporate-0002",
      },
      { db, actor: RAFIQ }
    )
    expect(result.corporateShareP).toBe(leftP)
    expect((await db.corporateEmployees.get(employee.id))!.usedP).toBe(contract.annualLimitP)
    await expectBalanced(db, result.invoiceId)
  })

  it("lines marked corporate are billed to the patient when the cover is no longer active", async () => {
    const employee = employees[2]
    await db.corporateEmployees.update(employee.id, { status: "left" })
    const { basket } = await corporateBasket(employee)
    const { result } = await commit(
      checkout,
      {
        patientId: basket.patientId,
        basketLineIds: basket.lineIds,
        tenders: [{ tender: "cash", amountP: basket.totalP }],
        idempotencyKey: "corporate-0003",
      },
      { db, actor: RAFIQ }
    )
    expect(result.corporateShareP).toBe(0)
    const invoice = (await db.invoices.get(result.invoiceId))!
    expect(invoice.payerType).toBe("self")
    expect(invoice.corporateClientId).toBeUndefined()
    expect(await db.payments.where("invoiceId").equals(result.invoiceId).count()).toBe(1)
  })
})
