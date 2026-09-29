import { Suspense } from "react"

import { DelaysScreen } from "@/modules/scheduling/components/delays-screen"

/** "/reception/delays": record a doctor's delay, tell booked patients, apply their choices. */
export default function DelaysPage() {
  return (
    <Suspense fallback={null}>
      <DelaysScreen />
    </Suspense>
  )
}
