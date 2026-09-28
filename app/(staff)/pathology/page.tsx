import { Suspense } from "react"

import { PathologyScreen } from "@/modules/lab/components/pathology-screen"

/** "/pathology": sign-off queue, reports and critical results (plan §9). */
export default function Page() {
  // The screen reads ?tab= (useSearchParams), so it renders on the client.
  return (
    <Suspense fallback={null}>
      <PathologyScreen />
    </Suspense>
  )
}
