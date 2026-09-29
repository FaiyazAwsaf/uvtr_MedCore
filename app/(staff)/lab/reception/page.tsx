import { Suspense } from "react"

import { ReceptionScreen } from "@/modules/lab/components/reception-screen"

/** "/lab/reception": add-on requests, then receive or reject specimens (plan §9). */
export default function Page() {
  // The screen reads ?focus= (useSearchParams), so it renders on the client.
  return (
    <Suspense fallback={null}>
      <ReceptionScreen />
    </Suspense>
  )
}
