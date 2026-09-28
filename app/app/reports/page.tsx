import { Suspense } from "react"

import { ReportsScreen } from "@/modules/patient-app/components/reports-screen"

/** Reads `?focus=` (or `?doctor=`) from the address, so it renders under Suspense. */
export default function Page() {
  return (
    <Suspense>
      <ReportsScreen />
    </Suspense>
  )
}
