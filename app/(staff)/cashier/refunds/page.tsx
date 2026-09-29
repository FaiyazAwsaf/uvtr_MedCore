import { Suspense } from "react"

import { RefundsScreen } from "@/modules/billing/components/refunds-screen"

/** "/cashier/refunds": cancellations and refunds by stage, to the original tender (plan §9). */
export default function CashierRefundsPage() {
  return (
    // The screen reads `?patient=` and `?invoice=` (useSearchParams), which needs a Suspense boundary.
    <Suspense fallback={null}>
      <RefundsScreen />
    </Suspense>
  )
}
