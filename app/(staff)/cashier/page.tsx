import { Suspense } from "react"

import { CashierScreen } from "@/modules/billing/components/cashier-screen"

/** "/cashier": patient bill, tenders and receipt (plan §9). */
export default function CashierPage() {
  return (
    // The screen reads `?patient=` (useSearchParams), which needs a Suspense boundary.
    <Suspense fallback={null}>
      <CashierScreen />
    </Suspense>
  )
}
