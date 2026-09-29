import { Suspense } from "react"

import { BookRoute } from "@/modules/patient-app/components/book-screen"

/** Reads `?focus=` (or `?doctor=`) from the address, so it renders under Suspense. */
export default function Page() {
  return (
    <Suspense>
      <BookRoute />
    </Suspense>
  )
}
