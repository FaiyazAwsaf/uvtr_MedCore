/**
 * i18n:check. Fails when a Bangla key is missing or extra, a string is empty,
 * or any string contains an em dash (CLAUDE.md rule 1). Warns when a Bangla
 * string is identical to its English one (possibly untranslated).
 */
import { bnFlat, enFlat } from "./i18n-lib"

const EM_DASH = String.fromCharCode(0x2014)
// Strings that are legitimately the same in both languages.
const SAME_OK = new Set(["brand.name"])

const errors: string[] = []
const warnings: string[] = []

for (const [key, value] of enFlat) {
  if (!bnFlat.has(key)) errors.push(`missing in bn: ${key}`)
  if (!value.trim()) errors.push(`empty en: ${key}`)
  if (value.includes(EM_DASH)) errors.push(`em dash in en: ${key}`)
}
for (const [key, value] of bnFlat) {
  if (!enFlat.has(key)) errors.push(`extra in bn: ${key}`)
  if (!value.trim()) errors.push(`empty bn: ${key}`)
  if (value.includes(EM_DASH)) errors.push(`em dash in bn: ${key}`)
  if (enFlat.get(key) === value && !SAME_OK.has(key)) {
    warnings.push(`bn same as en: ${key}`)
  }
}

for (const w of warnings) console.warn(`warn  ${w}`)
for (const e of errors) console.error(`error ${e}`)
console.log(
  `${enFlat.size} keys, ${errors.length} errors, ${warnings.length} warnings`
)
if (errors.length) process.exit(1)
