import type { Tone } from "@/components/shared/status"

import type { LineStage } from "../refunds"

/** Status-text tone of each stage on the refunds screen (coloured text, ui_guidelines §1). */
export const STAGE_TONE: Record<LineStage, Tone> = {
  "lab-awaiting": "info",
  "lab-collected": "warning",
  "lab-validated": "primary",
  "imaging-pending": "info",
  "imaging-done": "warning",
  "imaging-reported": "primary",
  "consult-open": "muted",
  "consult-seen": "muted",
  "consult-cancelled": "warning",
  medicine: "muted",
  "source-cancelled": "warning",
  other: "muted",
  "line-cancelled": "muted",
  "line-refunded": "muted",
}
