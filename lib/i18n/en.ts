import { coreEn } from "./core/en"
import { identityEn } from "@/modules/identity/i18n/en"
import { schedulingEn } from "@/modules/scheduling/i18n/en"
import { queueEn } from "@/modules/queue/i18n/en"
import { consultationEn } from "@/modules/consultation/i18n/en"
import { prescribingEn } from "@/modules/prescribing/i18n/en"
import { ordersEn } from "@/modules/orders/i18n/en"
import { libraryEn } from "@/modules/medicine-library/i18n/en"
import { billingEn } from "@/modules/billing/i18n/en"
import { labEn } from "@/modules/lab/i18n/en"
import { imagingEn } from "@/modules/imaging/i18n/en"
import { pharmacyEn } from "@/modules/pharmacy/i18n/en"
import { inventoryEn } from "@/modules/inventory/i18n/en"
import { procurementEn } from "@/modules/procurement/i18n/en"
import { financeEn } from "@/modules/finance/i18n/en"
import { inpatientEn } from "@/modules/inpatient/i18n/en"
import { commsEn } from "@/modules/comms/i18n/en"
import { dashboardsEn } from "@/modules/dashboards/i18n/en"
import { patientAppEn } from "@/modules/patient-app/i18n/en"
import { conceptsEn } from "@/modules/concepts/i18n/en"
import { demoEn } from "@/modules/demo/i18n/en"

/**
 * The English dictionary, composed from namespaces: the shared core plus one
 * namespace per module (docs/implementation_plan.md §3.11).
 */
export const en = {
  ...coreEn,
  ...identityEn,
  ...schedulingEn,
  ...queueEn,
  ...consultationEn,
  ...prescribingEn,
  ...ordersEn,
  ...libraryEn,
  ...billingEn,
  ...labEn,
  ...imagingEn,
  ...pharmacyEn,
  ...inventoryEn,
  ...procurementEn,
  ...financeEn,
  ...inpatientEn,
  ...commsEn,
  ...dashboardsEn,
  ...patientAppEn,
  ...conceptsEn,
  ...demoEn,
}

export type Dictionary = typeof en
