import { Suspense } from "react"

import { BookingScreen } from "@/modules/scheduling/components/booking-screen"

/** "/reception/book": doctor directory, sessions and slots (the one scheduler). */
export default function BookPage() {
  return (
    <Suspense fallback={null}>
      <BookingScreen />
    </Suspense>
  )
}
