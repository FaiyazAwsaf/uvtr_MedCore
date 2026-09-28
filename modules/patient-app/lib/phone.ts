/**
 * Bangladeshi mobile numbers for the OTP sign-in: 11 digits starting 01,
 * written with or without a dash or the +88 country code.
 */

/** The 11-digit local form (01XXXXXXXXX), or the bare digits when it is not one. */
export function localMobile(input: string): string {
  const digits = input.replace(/\D/g, "")
  if (digits.length === 13 && digits.startsWith("880")) return digits.slice(2)
  return digits
}

export function isBdMobile(input: string): boolean {
  return /^01[3-9]\d{8}$/.test(localMobile(input))
}

export function samePhone(
  a: string | undefined,
  b: string | undefined
): boolean {
  if (!a || !b) return false
  return isBdMobile(a) && localMobile(a) === localMobile(b)
}
