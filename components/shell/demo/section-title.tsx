import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** Section heading inside the demo drawers: icon well, title and a muted hint. */
export function SectionTitle({
  icon: Icon,
  title,
  hint,
  className,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex gap-2.5",
        hint ? "items-start" : "items-center",
        className
      )}
    >
      <span className="icon-well flex size-8 shrink-0 items-center justify-center text-primary">
        <Icon className="size-4" />
      </span>
      <div className={cn("min-w-0", hint && "pt-0.5")}>
        <h3 className="text-sm leading-tight font-semibold">{title}</h3>
        {hint ? (
          <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  )
}
