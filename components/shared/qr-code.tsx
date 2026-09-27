"use client"

import { QRCodeSVG } from "qrcode.react"

import { cn } from "@/lib/utils"

/**
 * QR code (check-in, report verification) via qrcode.react. Black on a white
 * plate so it scans from either theme and prints cleanly.
 */
export function QrCode({
  value,
  size = 128,
  level = "M",
  plate = true,
  title,
  className,
}: {
  value: string
  /** Pixel size of the code itself */
  size?: number
  level?: "L" | "M" | "Q" | "H"
  /** White background plate with padding (off for print layouts) */
  plate?: boolean
  title?: string
  className?: string
}) {
  return (
    <span
      data-slot="qr-code"
      className={cn(
        "inline-flex items-center justify-center",
        plate && "rounded-md bg-white p-2.5",
        className
      )}
    >
      <QRCodeSVG
        value={value}
        size={size}
        level={level}
        bgColor="#ffffff"
        fgColor="#000000"
        marginSize={0}
        title={title}
      />
    </span>
  )
}
