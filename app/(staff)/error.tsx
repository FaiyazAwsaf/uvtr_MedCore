"use client"

import * as React from "react"
import { RotateCcw, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/provider"

/**
 * Staff route error boundary. Next 16 passes `retry` (re-render the segment)
 * and `reset`; either recovers a client-only screen.
 */
export default function AppError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string }
  retry?: () => void
  reset?: () => void
}) {
  const t = useT()
  React.useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10">
      <div className="surface-card flex w-full max-w-lg flex-col items-center gap-4 p-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--destructive)_15%,transparent)] text-destructive">
          <TriangleAlert className="size-6" />
        </span>
        <p className="text-[1.0625rem] font-semibold">{t("shell.errorTitle")}</p>
        <p className="max-w-[46ch] font-mono text-xs break-words text-muted-foreground">
          {error.message}
        </p>
        <Button onClick={() => (retry ?? reset)?.()} className="mt-1">
          <RotateCcw />
          {t("shell.tryAgain")}
        </Button>
      </div>
    </div>
  )
}
