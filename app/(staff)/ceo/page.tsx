import { Suspense } from "react"

import { CeoDashboard } from "@/modules/dashboards/components/ceo-dashboard"

/** "/ceo": the executive dashboard with drill-down (plan §9). */
export default function CeoPage() {
  return (
    // The view lives in the address (`?period=&branch=&dept=`), read with
    // useSearchParams, which needs a Suspense boundary.
    <Suspense fallback={null}>
      <CeoDashboard />
    </Suspense>
  )
}
