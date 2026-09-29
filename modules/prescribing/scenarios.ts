import { openEncounter, pickPatient } from "@/core/scenarios/fixtures"
import type { ScenarioDef } from "@/core/scenarios/types"
import { SEED_REFS } from "@/core/seed/content"
import { moveStock } from "@/modules/inventory/stock"

/** Scenario launchers owned by this module (plan §10). */
export const prescribingScenarios: ScenarioDef[] = [
  {
    id: "S2",
    kind: "scenario",
    module: "prescribing",
    titleKey: "prescribing.scenarios.S2.title",
    summaryKey: "prescribing.scenarios.S2.summary",
    persona: "per_doctor_kamal",
    async setup(kit) {
      // A transfer received in an earlier run may have restocked Dhanmondi:
      // take Zimax 500 back to none there, with the adjustment on record.
      await kit.fixture(
        "Zimax 500 out at B1",
        async (tx) => {
          const levels = await tx.list("stockLevels", "[branchId+brandId]", [
            "B1",
            SEED_REFS.brand.zimax500,
          ])
          for (const level of levels) {
            if (level.qty > 0) {
              await moveStock(tx, level, {
                type: "adjust",
                qty: -level.qty,
                reason: "Demo setup S2: Zimax 500 out at Dhanmondi",
              })
            }
          }
          // A request from an earlier run that was never dispatched would
          // hide the "Request transfer" button: withdraw it.
          const lines = await tx.list(
            "transferLines",
            "brandId",
            SEED_REFS.brand.zimax500
          )
          for (const transferId of new Set(lines.map((l) => l.transferId))) {
            const transfer = await tx.get("transfers", transferId)
            if (
              transfer.toBranchId === "B1" &&
              transfer.status === "requested"
            ) {
              await tx.update("transfers", transferId, {
                status: "cancelled",
                note: "Withdrawn by the demo setup (S2 re-run)",
              })
            }
          }
        },
        "per_pharmacist_shirin"
      )
      const patient = await pickPatient(kit, {
        branch: "B1",
        minAge: 18,
        noAllergies: true,
        selfPay: true,
      })
      const encounterId = await openEncounter(kit, { patientId: patient.id })
      return {
        refs: { patientId: patient.id, encounterId },
        params: { name: patient.nameEn, nameBn: patient.nameBn },
      }
    },
    route: ({ refs }) => `/doctor/encounter/${refs?.encounterId}`,
    cueKeys: [
      "prescribing.scenarios.S2.cue.1",
      "prescribing.scenarios.S2.cue.2",
      "prescribing.scenarios.S2.cue.3",
      "prescribing.scenarios.S2.cue.4",
      "prescribing.scenarios.S2.cue.5",
    ],
  },
]
