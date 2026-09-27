"use client"

import * as React from "react"
import JsBarcode from "jsbarcode"

import { cn } from "@/lib/utils"

/**
 * Code128 barcode (accession labels, pharmacy labels, receipts) drawn with
 * jsbarcode into an SVG. The value must be plain ASCII (identifiers are
 * always Latin, plan §3.11). Rendered black on a white plate so it scans in
 * both themes and prints cleanly.
 */
export function Barcode({
  value,
  height = 48,
  barWidth = 1.6,
  showValue = true,
  fontSize = 12,
  plate = true,
  className,
}: {
  value: string
  height?: number
  /** Width of the narrowest bar in px */
  barWidth?: number
  showValue?: boolean
  fontSize?: number
  /** White background plate with padding (off for print layouts) */
  plate?: boolean
  className?: string
}) {
  const ref = React.useRef<SVGSVGElement>(null)
  // Code128 takes printable ASCII only; anything else shows as plain text.
  const valid = /^[\x20-\x7e]+$/.test(value)

  React.useEffect(() => {
    const svg = ref.current
    if (!svg || !valid) return
    try {
      JsBarcode(svg, value, {
        format: "CODE128",
        height,
        width: barWidth,
        displayValue: showValue,
        fontSize,
        font: "monospace",
        margin: 0,
        textMargin: 4,
        background: "transparent",
        lineColor: "#000000",
      })
    } catch {
      svg.replaceChildren()
    }
  }, [value, valid, height, barWidth, showValue, fontSize])

  return (
    <span
      data-slot="barcode"
      className={cn(
        "inline-flex flex-col items-center text-black",
        plate && "rounded-sm bg-white px-3 py-2",
        className
      )}
    >
      {!valid ? (
        <span className="font-mono text-xs">{value}</span>
      ) : (
        <svg ref={ref} role="img" aria-label={value} />
      )}
    </span>
  )
}
