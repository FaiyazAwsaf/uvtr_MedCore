import Dexie, { type Table } from "dexie"

import type { ClockRow, DemoMetaRow, NetworkRow } from "./schema"

export const CONTROL_DB_NAME = "medcore-control"

/**
 * Demo controls shared by every window: the demo clock offset, each branch's
 * network state, and seed metadata (plan §3.2). No domain data lives here.
 */
export class ControlDb extends Dexie {
  clock!: Table<ClockRow, string>
  network!: Table<NetworkRow, string>
  demoMeta!: Table<DemoMetaRow, string>

  constructor(name: string = CONTROL_DB_NAME) {
    super(name, { chromeTransactionDurability: "strict" })
    this.version(1).stores({
      clock: "id",
      network: "branchId",
      demoMeta: "id",
    })
  }
}

let control: ControlDb | null = null

export function getControlDb(): ControlDb {
  if (!control) control = new ControlDb()
  return control
}

/** Test hook: point the control DB at a fresh name. */
export function setControlDbForTests(db: ControlDb): void {
  control = db
}
