"use client"

import { toast, type ExternalToast } from "sonner"

/**
 * Toasts for lab screens. Sonner's toaster sets its own system font stack,
 * which has no Bangla face on some machines; `font-sans` puts the app stack
 * (Inter with the embedded Noto Sans Bengali fallback) back on each toast.
 */
const withFont = (opts?: ExternalToast): ExternalToast => ({
  ...opts,
  className: ["font-sans", opts?.className].filter(Boolean).join(" "),
})

export const labToast = {
  success: (message: string, opts?: ExternalToast) =>
    toast.success(message, withFont(opts)),
  warning: (message: string, opts?: ExternalToast) =>
    toast.warning(message, withFont(opts)),
  info: (message: string, opts?: ExternalToast) =>
    toast.info(message, withFont(opts)),
}
