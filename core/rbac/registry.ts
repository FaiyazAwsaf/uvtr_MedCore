import type { NavItem } from "@/core/rbac/types"
import { identityNav } from "@/modules/identity/nav"
import { schedulingNav } from "@/modules/scheduling/nav"
import { queueNav } from "@/modules/queue/nav"
import { consultationNav } from "@/modules/consultation/nav"
import { prescribingNav } from "@/modules/prescribing/nav"
import { ordersNav } from "@/modules/orders/nav"
import { libraryNav } from "@/modules/medicine-library/nav"
import { billingNav } from "@/modules/billing/nav"
import { labNav } from "@/modules/lab/nav"
import { imagingNav } from "@/modules/imaging/nav"
import { pharmacyNav } from "@/modules/pharmacy/nav"
import { inventoryNav } from "@/modules/inventory/nav"
import { procurementNav } from "@/modules/procurement/nav"
import { financeNav } from "@/modules/finance/nav"
import { inpatientNav } from "@/modules/inpatient/nav"
import { commsNav } from "@/modules/comms/nav"
import { dashboardsNav } from "@/modules/dashboards/nav"
import { patientAppNav } from "@/modules/patient-app/nav"
import { conceptsNav } from "@/modules/concepts/nav"
import { demoNav } from "@/modules/demo/nav"

/** Every module's sidebar entries. Only the main agent edits this file. */
export const NAV_ITEMS: NavItem[] = [
  ...identityNav,
  ...schedulingNav,
  ...queueNav,
  ...consultationNav,
  ...prescribingNav,
  ...ordersNav,
  ...libraryNav,
  ...billingNav,
  ...labNav,
  ...imagingNav,
  ...pharmacyNav,
  ...inventoryNav,
  ...procurementNav,
  ...financeNav,
  ...inpatientNav,
  ...commsNav,
  ...dashboardsNav,
  ...patientAppNav,
  ...conceptsNav,
  ...demoNav,
]
