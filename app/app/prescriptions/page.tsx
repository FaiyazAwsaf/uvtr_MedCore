import { Suspense } from "react"

import { PrescriptionsScreen } from "@/modules/patient-app/components/prescriptions-screen"

/** Reads `?focus=` (or `?doctor=`) from the address, so it renders under Suspense. */
export default function Page() {
  return (
    <Suspense>
      <PrescriptionsScreen />
    </Suspense>
  )
}
