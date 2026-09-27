import type { ScenarioDef } from "@/core/scenarios/types"
import { identityScenarios } from "@/modules/identity/scenarios"
import { schedulingScenarios } from "@/modules/scheduling/scenarios"
import { queueScenarios } from "@/modules/queue/scenarios"
import { consultationScenarios } from "@/modules/consultation/scenarios"
import { prescribingScenarios } from "@/modules/prescribing/scenarios"
import { ordersScenarios } from "@/modules/orders/scenarios"
import { libraryScenarios } from "@/modules/medicine-library/scenarios"
import { billingScenarios } from "@/modules/billing/scenarios"
import { labScenarios } from "@/modules/lab/scenarios"
import { imagingScenarios } from "@/modules/imaging/scenarios"
import { pharmacyScenarios } from "@/modules/pharmacy/scenarios"
import { inventoryScenarios } from "@/modules/inventory/scenarios"
import { procurementScenarios } from "@/modules/procurement/scenarios"
import { financeScenarios } from "@/modules/finance/scenarios"
import { inpatientScenarios } from "@/modules/inpatient/scenarios"
import { commsScenarios } from "@/modules/comms/scenarios"
import { dashboardsScenarios } from "@/modules/dashboards/scenarios"
import { patientAppScenarios } from "@/modules/patient-app/scenarios"
import { conceptsScenarios } from "@/modules/concepts/scenarios"
import { demoScenarios } from "@/modules/demo/scenarios"

/** Every scenario launcher. Only the main agent edits this file. */
export const SCENARIOS: ScenarioDef[] = [
  ...identityScenarios,
  ...schedulingScenarios,
  ...queueScenarios,
  ...consultationScenarios,
  ...prescribingScenarios,
  ...ordersScenarios,
  ...libraryScenarios,
  ...billingScenarios,
  ...labScenarios,
  ...imagingScenarios,
  ...pharmacyScenarios,
  ...inventoryScenarios,
  ...procurementScenarios,
  ...financeScenarios,
  ...inpatientScenarios,
  ...commsScenarios,
  ...dashboardsScenarios,
  ...patientAppScenarios,
  ...conceptsScenarios,
  ...demoScenarios,
]
