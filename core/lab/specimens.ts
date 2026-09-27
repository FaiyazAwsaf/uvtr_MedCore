import type { Container, LabOrderItemRow, SpecimenRow } from "@/core/db/schema"
import { nextAccessionNo } from "@/core/engine/docNumbers"
import type { Tx } from "@/core/engine/types"

/**
 * One specimen per order and container for newly paid lab items (plan §6,
 * `billing.checkout`): a CBC and an HbA1c share one EDTA tube; a CRP goes in
 * a plain tube. Items get their `specimenId`; specimens start awaiting
 * collection with an accession number (from the offline range when the
 * branch is offline). Imaging items are skipped.
 */
export async function createSpecimensForItems(
  tx: Tx,
  items: LabOrderItemRow[]
): Promise<SpecimenRow[]> {
  const groups = new Map<string, { items: LabOrderItemRow[]; container: Container; volume: number }>()
  for (const item of items) {
    if (item.specimenId) continue
    const test = await tx.get("labTests", item.testId)
    if (test.kind !== "lab" || test.container === "none") continue
    const key = `${item.labOrderId}:${test.container}`
    const group = groups.get(key) ?? { items: [], container: test.container, volume: 0 }
    group.items.push(item)
    group.volume += test.volumeMl
    groups.set(key, group)
  }
  const specimens: SpecimenRow[] = []
  for (const group of groups.values()) {
    const first = group.items[0]
    const accessionNo = await nextAccessionNo(tx, first.branchId)
    const specimen = tx.insert("specimens", {
      accessionNo,
      barcode: accessionNo,
      patientId: first.patientId,
      branchId: first.branchId,
      labOrderId: first.labOrderId,
      itemIds: group.items.map((i) => i.id),
      container: group.container,
      status: "awaiting-collection",
      volumeRemainingMl: group.volume,
    })
    for (const item of group.items) {
      await tx.update("labOrderItems", item.id, { specimenId: specimen.id })
    }
    specimens.push(specimen)
  }
  return specimens
}
