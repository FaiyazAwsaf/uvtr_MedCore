import { Suspense } from "react"

import { RequestsScreen } from "@/modules/procurement/components/requests-screen"

/** "/store/requests": purchase requests and the request editor (plan §9). */
export default function RequestsPage() {
  return (
    // The screen reads `?pr=`, `?new=` and `?add=` (useSearchParams), which needs a Suspense boundary.
    <Suspense fallback={null}>
      <RequestsScreen />
    </Suspense>
  )
}
