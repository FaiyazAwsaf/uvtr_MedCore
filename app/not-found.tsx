"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/provider"

export default function NotFound() {
  const t = useT()
  return (
    <div className="flex h-svh flex-col items-center justify-center gap-3 bg-background text-center">
      <p className="figure text-5xl text-muted-foreground">404</p>
      <p className="text-sm font-medium">{t("shell.notFound")}</p>
      <Button
        size="sm"
        nativeButton={false}
        render={<Link href="/" />}
        className="mt-1"
      >
        {t("shell.backToLauncher")}
      </Button>
    </div>
  )
}
