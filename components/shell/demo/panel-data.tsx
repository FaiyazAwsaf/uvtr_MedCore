"use client"

import * as React from "react"
import Link from "next/link"
import { Database, ScrollText, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useDb } from "@/core/db/DbProvider"
import { useLocale } from "@/lib/i18n/provider"
import { SeedStatus } from "@/modules/demo/components/seed-status"
import { tamperMiddleAuditRow } from "@/modules/demo/components/tamper"

import { SectionTitle } from "./section-title"
import { useDemoUi } from "./store"

/** Seed status, reset, the audit tamper test and a link to the audit viewer. */
export function DataSection() {
  const { t } = useLocale()
  const db = useDb()
  const [tampered, setTampered] = React.useState<number | null | "none">(null)
  const [busy, setBusy] = React.useState(false)

  const tamper = async () => {
    setBusy(true)
    try {
      const seq = await tamperMiddleAuditRow(db)
      setTampered(seq ?? "none")
    } catch (error) {
      console.error("tamper test", error)
      toast.error(String(error))
    } finally {
      setBusy(false)
    }
  }

  const auditLink = (
    <Button
      variant="link"
      size="sm"
      className="self-start px-0"
      nativeButton={false}
      render={
        <Link
          href="/audit"
          onClick={() => useDemoUi.getState().setPanelOpen(false)}
        />
      }
    >
      <ScrollText />
      {t("demo.data.openAudit")}
    </Button>
  )

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <SectionTitle icon={Database} title={t("demo.seed.title")} />
        <div className="rounded-lg bg-card p-3">
          <SeedStatus />
        </div>
      </section>

      <section className="flex flex-col gap-3" data-testid="demo-tamper">
        <SectionTitle
          icon={ShieldAlert}
          title={t("demo.data.title")}
          hint={t("demo.data.tamperHint")}
        />
        <div className="flex flex-col gap-2 rounded-lg bg-card p-3">
          <Button
            variant="destructive"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={tamper}
            data-testid="demo-tamper-button"
          >
            <ShieldAlert />
            {t("demo.data.tamper")}
          </Button>
          {tampered === "none" ? (
            <p className="text-xs text-muted-foreground">
              {t("demo.data.tamperEmpty")}
            </p>
          ) : tampered !== null ? (
            <p
              role="status"
              className="text-xs text-warning"
              data-testid="demo-tampered"
            >
              {t("demo.data.tampered", { seq: tampered })}
            </p>
          ) : null}
          {auditLink}
        </div>
      </section>
    </div>
  )
}
