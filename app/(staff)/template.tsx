"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { motion } from "motion/react"

/**
 * Page transition: a fade and a 4px rise (docs/ui_guidelines.md §5).
 *
 * This lives in a template rather than the layout so the enter animation runs
 * on mount without AnimatePresence. The previous approach (`AnimatePresence
 * mode="wait"` keyed on the pathname) intermittently left the incoming page
 * stuck at its `initial` style (mounted, but opacity 0) when the outgoing exit
 * and the incoming mount landed in the same frame, which read as a blank
 * screen until a reload.
 *
 * Next 16 only remounts a template when its own child segment changes, so
 * /doctor to /doctor/inbox would not animate; keying the wrapper on the
 * pathname restores a transition on every page change.
 */
export default function AppTemplate({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="flex flex-1 flex-col"
    >
      {children}
    </motion.div>
  )
}
