"use client"

import { useT } from "@/lib/i18n/provider"

/** Placeholder launcher. The real launcher (role cards, 4-window opener) arrives with WS-Shell in Phase 1. */
export default function LauncherPage() {
  const t = useT()
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 bg-background p-6 text-center">
      <p className="text-3xl font-semibold tracking-tight">
        <span className="text-foreground">UVTR_</span>
        <span className="text-primary">MedCore</span>
      </p>
      <p className="text-sm text-muted-foreground">{t("brand.tagline")}</p>
      <p className="mt-6 text-base font-medium">{t("shell.launcherTitle")}</p>
      <p className="text-sm text-muted-foreground">
        {t("shell.launcherSubtitle")}
      </p>
    </main>
  )
}
