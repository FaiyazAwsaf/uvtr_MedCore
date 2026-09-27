import { coreBn } from "./core/bn"
import type { Dictionary } from "./en"

/** The Bangla dictionary. It must match the English shape exactly. */
export const bn: Dictionary = {
  ...coreBn,
}
