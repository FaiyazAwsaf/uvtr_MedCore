import { Suspense } from "react"

import { MfsScreen } from "@/modules/finance/components/mfs-screen"

/** "/finance/mfs": bKash and Nagad settlement import and match (plan §9). */
export default function FinanceMfsPage() {
  return (
    // The screen reads `?file=` (useSearchParams), which needs a Suspense boundary.
    <Suspense fallback={null}>
      <MfsScreen />
    </Suspense>
  )
}
