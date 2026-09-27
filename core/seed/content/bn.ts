/** Bangla digits for free text written in Bangla (bios, dose words, labels). */

const DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"]

export function bnDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => DIGITS[Number(d)])
}
