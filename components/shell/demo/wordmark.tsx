import { cn } from "@/lib/utils"

/**
 * The staff-app wordmark: "UVTR_" in the foreground colour and "MedCore" in
 * turquoise, echoing the sample's two-tone logo (ui_guidelines §3). A local
 * copy for the launcher and Demo Wall headers.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-semibold tracking-tight whitespace-nowrap",
        className
      )}
      translate="no"
    >
      <span className="text-foreground">UVTR_</span>
      <span className="text-primary">MedCore</span>
    </span>
  )
}
