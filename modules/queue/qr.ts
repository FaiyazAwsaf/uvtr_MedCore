import type { AppointmentRow } from "@/core/db/schema"

/** The appointment id inside a check-in QR payload ("MC|APT|<id>" or "MEDCORE:APT:<id>"). */
export function appointmentIdFromQr(code: string): string | undefined {
  const match = /APT[|:]([a-z0-9_]+)\s*$/i.exec(code.trim())
  return match?.[1]
}

/** The appointment a scanned code points to, among the given ones. */
export function findByQr<A extends Pick<AppointmentRow, "id" | "qrCode">>(
  appointments: A[],
  code: string
): A | undefined {
  const value = code.trim()
  if (!value) return undefined
  const id = appointmentIdFromQr(value)
  return (
    appointments.find((a) => a.qrCode === value) ??
    (id ? appointments.find((a) => a.id === id) : undefined)
  )
}
