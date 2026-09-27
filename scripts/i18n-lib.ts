import { bn } from "@/lib/i18n/bn"
import { en } from "@/lib/i18n/en"

/** Flattens a nested dictionary into dot-path keys. */
export function flatten(node: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof node === "string") {
    out.set(prefix, node)
    return out
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      for (const [k, v] of flatten(value, prefix ? `${prefix}.${key}` : key)) {
        out.set(k, v)
      }
    }
  }
  return out
}

export const enFlat = flatten(en)
export const bnFlat = flatten(bn)
