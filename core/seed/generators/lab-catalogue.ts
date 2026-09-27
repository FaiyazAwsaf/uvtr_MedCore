/** Lab test and imaging catalogue rows (plan §7.1). */

import type { SeedCtx } from "../context"
import { ALL_TESTS } from "../content/lab-tests"
import { DAY } from "../time"

export function seedLabCatalogue(ctx: SeedCtx): void {
  const at = ctx.now - 3 * 365 * DAY
  for (const { id, ...test } of ALL_TESTS) {
    ctx.bag.put("labTests", id, at, test)
  }
}
