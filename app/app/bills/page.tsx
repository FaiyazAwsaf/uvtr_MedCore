import { Suspense } from "react"

import { BillsScreen } from "@/modules/patient-app/components/bills-screen"

/** Reads `?focus=` (or `?doctor=`) from the address, so it renders under Suspense. */
export default function Page() {
  return (
    <Suspense>
      <BillsScreen />
    </Suspense>
  )
}
