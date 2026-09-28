import { Suspense } from "react"

import { AppointmentsScreen } from "@/modules/patient-app/components/appointments-screen"

/** Reads `?focus=` (or `?doctor=`) from the address, so it renders under Suspense. */
export default function Page() {
  return (
    <Suspense>
      <AppointmentsScreen />
    </Suspense>
  )
}
