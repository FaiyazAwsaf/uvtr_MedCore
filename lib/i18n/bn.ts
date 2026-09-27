import { coreBn } from "./core/bn"
import { identityBn } from "@/modules/identity/i18n/bn"
import { schedulingBn } from "@/modules/scheduling/i18n/bn"
import { queueBn } from "@/modules/queue/i18n/bn"
import { consultationBn } from "@/modules/consultation/i18n/bn"
import { prescribingBn } from "@/modules/prescribing/i18n/bn"
import { ordersBn } from "@/modules/orders/i18n/bn"
import { libraryBn } from "@/modules/medicine-library/i18n/bn"
import { billingBn } from "@/modules/billing/i18n/bn"
import { labBn } from "@/modules/lab/i18n/bn"
import { imagingBn } from "@/modules/imaging/i18n/bn"
import { pharmacyBn } from "@/modules/pharmacy/i18n/bn"
import { inventoryBn } from "@/modules/inventory/i18n/bn"
import { procurementBn } from "@/modules/procurement/i18n/bn"
import { financeBn } from "@/modules/finance/i18n/bn"
import { inpatientBn } from "@/modules/inpatient/i18n/bn"
import { commsBn } from "@/modules/comms/i18n/bn"
import { dashboardsBn } from "@/modules/dashboards/i18n/bn"
import { patientAppBn } from "@/modules/patient-app/i18n/bn"
import { conceptsBn } from "@/modules/concepts/i18n/bn"
import { demoBn } from "@/modules/demo/i18n/bn"
import type { Dictionary } from "./en"

/** The Bangla dictionary. It must match the English shape exactly. */
export const bn: Dictionary = {
  ...coreBn,
  ...identityBn,
  ...schedulingBn,
  ...queueBn,
  ...consultationBn,
  ...prescribingBn,
  ...ordersBn,
  ...libraryBn,
  ...billingBn,
  ...labBn,
  ...imagingBn,
  ...pharmacyBn,
  ...inventoryBn,
  ...procurementBn,
  ...financeBn,
  ...inpatientBn,
  ...commsBn,
  ...dashboardsBn,
  ...patientAppBn,
  ...conceptsBn,
  ...demoBn,
}
