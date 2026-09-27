import type { SweepJob } from "@/core/clock/types"
import { identityJobs } from "@/modules/identity/jobs"
import { schedulingJobs } from "@/modules/scheduling/jobs"
import { queueJobs } from "@/modules/queue/jobs"
import { consultationJobs } from "@/modules/consultation/jobs"
import { prescribingJobs } from "@/modules/prescribing/jobs"
import { ordersJobs } from "@/modules/orders/jobs"
import { libraryJobs } from "@/modules/medicine-library/jobs"
import { billingJobs } from "@/modules/billing/jobs"
import { labJobs } from "@/modules/lab/jobs"
import { imagingJobs } from "@/modules/imaging/jobs"
import { pharmacyJobs } from "@/modules/pharmacy/jobs"
import { inventoryJobs } from "@/modules/inventory/jobs"
import { procurementJobs } from "@/modules/procurement/jobs"
import { financeJobs } from "@/modules/finance/jobs"
import { inpatientJobs } from "@/modules/inpatient/jobs"
import { commsJobs } from "@/modules/comms/jobs"
import { dashboardsJobs } from "@/modules/dashboards/jobs"
import { patientAppJobs } from "@/modules/patient-app/jobs"
import { conceptsJobs } from "@/modules/concepts/jobs"
import { demoJobs } from "@/modules/demo/jobs"

/** Every module's sweep jobs. Only the main agent edits this file. */
export const SWEEP_JOBS: SweepJob[] = [
  ...identityJobs,
  ...schedulingJobs,
  ...queueJobs,
  ...consultationJobs,
  ...prescribingJobs,
  ...ordersJobs,
  ...libraryJobs,
  ...billingJobs,
  ...labJobs,
  ...imagingJobs,
  ...pharmacyJobs,
  ...inventoryJobs,
  ...procurementJobs,
  ...financeJobs,
  ...inpatientJobs,
  ...commsJobs,
  ...dashboardsJobs,
  ...patientAppJobs,
  ...conceptsJobs,
  ...demoJobs,
]
