import type { z } from "zod"

import type { CommandDef } from "./types"

/**
 * Declare a command. Keeps the input schema, allowed roles and run function
 * together and fully typed:
 *
 *   export const signRx = defineCommand({
 *     name: "rx.sign",
 *     roles: ["doctor"],
 *     input: z.object({ rxId: z.string(), expectedVersion: z.number() }),
 *     async run(tx, input) { ... },
 *   })
 */
export function defineCommand<S extends z.ZodType, O>(
  def: CommandDef<S, O>
): CommandDef<S, O> {
  return def
}
