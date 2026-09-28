import { Suspense } from "react"

import { QueueScreen } from "@/modules/queue/components/queue-screen"

/** "/reception/queue": check-in (desk and simulated QR), walk-ins and tokens. */
export default function QueuePage() {
  return (
    <Suspense fallback={null}>
      <QueueScreen />
    </Suspense>
  )
}
