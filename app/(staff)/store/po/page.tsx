import { Suspense } from "react"

import { PoScreen } from "@/modules/procurement/components/po-screen"

/** "/store/po": purchase orders, and one order's detail with `?po=` (plan §9). */
export default function PurchaseOrdersPage() {
  return (
    // The screen reads `?po=` (useSearchParams), which needs a Suspense boundary.
    <Suspense fallback={null}>
      <PoScreen />
    </Suspense>
  )
}
