import { Suspense } from "react"

import { FrontDesk } from "@/modules/identity/components/front-desk"

/** "/reception": the front desk (search, household picker, registration). */
export default function ReceptionPage() {
  return (
    <Suspense fallback={null}>
      <FrontDesk />
    </Suspense>
  )
}
