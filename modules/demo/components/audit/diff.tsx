import type { AuditRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"

/**
 * Monospace with a Bangla fallback, for stored values that may hold Bangla
 * text (nameBn, instructionsBn): the mono face alone has no Bengali glyphs.
 */
export const MONO_DATA =
  "[font-family:var(--font-mono),var(--font-bangla),ui-monospace,monospace]"

/** A compact, single-line rendering of any stored value. */
export function formatValue(value: unknown, max = 48): string {
  let text: string
  if (value === undefined) text = "∅"
  else if (value === null) text = "null"
  else if (typeof value === "string") text = value === "" ? '""' : value
  else if (typeof value === "number" || typeof value === "boolean")
    text = String(value)
  else {
    try {
      text = JSON.stringify(value) ?? String(value)
    } catch {
      text = String(value)
    }
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export type DiffLine = {
  field: string
  before?: unknown
  after?: unknown
  kind: "set" | "change" | "remove"
}

/** The changed fields of an audit row, as display lines. */
export function diffLines(
  row: Pick<AuditRow, "action" | "before" | "after">
): DiffLine[] {
  const before = row.before ?? {}
  const after = row.after ?? {}
  if (row.action === "update") {
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    return fields.map((field) => ({
      field,
      before: before[field],
      after: after[field],
      kind: "change" as const,
    }))
  }
  if (row.action === "delete") {
    return Object.keys(before).map((field) => ({
      field,
      before: before[field],
      kind: "remove" as const,
    }))
  }
  return Object.keys(after).map((field) => ({
    field,
    after: after[field],
    kind: "set" as const,
  }))
}

/**
 * Old to new, one line per field: `phone: 01711-523418 → 01812-000111`.
 * `limit` keeps table cells short; the rest is summarised as "+N more".
 */
export function DiffList({
  lines,
  limit,
  moreLabel,
  className,
  max = 40,
}: {
  lines: DiffLine[]
  limit?: number
  moreLabel?: (count: number) => string
  className?: string
  max?: number
}) {
  const shown = limit ? lines.slice(0, limit) : lines
  const rest = lines.length - shown.length
  return (
    <ul className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      {shown.map((line) => (
        <li
          key={line.field}
          className={cn(
            "min-w-0 truncate text-[0.6875rem] leading-relaxed",
            MONO_DATA
          )}
        >
          <span className="text-muted-foreground">{line.field}: </span>
          {line.kind === "change" ? (
            <>
              <span className="text-destructive/90 line-through decoration-destructive/40">
                {formatValue(line.before, max)}
              </span>
              <span className="text-muted-foreground"> → </span>
              <span className="text-success">
                {formatValue(line.after, max)}
              </span>
            </>
          ) : line.kind === "remove" ? (
            <span className="text-destructive/90 line-through decoration-destructive/40">
              {formatValue(line.before, max)}
            </span>
          ) : (
            <span className="text-foreground">
              {formatValue(line.after, max)}
            </span>
          )}
        </li>
      ))}
      {rest > 0 && moreLabel ? (
        <li className="text-[0.6875rem] text-muted-foreground">
          {moreLabel(rest)}
        </li>
      ) : null}
    </ul>
  )
}
