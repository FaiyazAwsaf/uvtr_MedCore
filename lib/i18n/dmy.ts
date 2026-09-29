/**
 * DD-MM-YYYY date entry (plan §3.11) independent of the browser's locale.
 * Bangla digits are accepted; an ISO date typed as is also works.
 */

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯"

export function latinDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)))
}

/** ISO date (YYYY-MM-DD) from DD-MM-YYYY (or ISO), or "" if incomplete or not a real date. */
export function parseDmy(text: string): string {
  const value = latinDigits(text.trim())
  let y: number, m: number, d: number
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (iso) {
    ;[y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  } else {
    const digits = value.replace(/\D/g, "")
    if (digits.length !== 8) return ""
    ;[d, m, y] = [Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4))]
  }
  if (y < 1900 || m < 1 || m > 12 || d < 1) return ""
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > days) return ""
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

export function isoToDmy(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : ""
}

/** What has been typed so far, shown as DD-MM-YYYY. */
export function formatTyping(raw: string): string {
  const value = latinDigits(raw)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return isoToDmy(value.trim())
  const digits = value.replace(/\D/g, "").slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`
}
