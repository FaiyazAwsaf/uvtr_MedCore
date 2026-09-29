import { Suspense } from "react"

import { GrnScreen } from "@/modules/procurement/components/grn-screen"

/** "/store/grn": deliveries due, and the goods receipt form with `?po=` (plan §9, S12). */
export default function GoodsReceiptPage() {
  return (
    // The screen reads `?po=` (useSearchParams), which needs a Suspense boundary.
    <Suspense fallback={null}>
      <GrnScreen />
    </Suspense>
  )
}
