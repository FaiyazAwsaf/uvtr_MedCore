"use client"

import * as React from "react"
import { ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

const CATEGORIES = [
  "medication",
  "identification",
  "result",
  "equipment",
  "other",
] as const
type Category = (typeof CATEGORIES)[number]

/**
 * "Report a safety concern" (PRD §20): on every clinical screen. Opens a short,
 * blame-free form. Sending is simulated in this release (a toast confirms).
 */
export function ReportSafetyConcernButton({
  context,
  variant = "neutral",
  size = "sm",
  iconOnly = false,
  className,
}: {
  /** Where it was raised (screen or record), shown in the form */
  context?: string
  variant?: "neutral" | "ghost" | "outline"
  size?: "sm" | "default" | "xs"
  iconOnly?: boolean
  className?: string
}) {
  const { t } = useLocale()
  const [open, setOpen] = React.useState(false)
  const [category, setCategory] = React.useState<Category>("medication")
  const [details, setDetails] = React.useState("")
  const [anonymous, setAnonymous] = React.useState(false)

  const reset = () => {
    setCategory("medication")
    setDetails("")
    setAnonymous(false)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!details.trim()) return
    toast.success(t("common.safety.sent"))
    reset()
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={iconOnly ? (size === "default" ? "icon" : "icon-sm") : size}
        title={t("common.safety.button")}
        aria-label={iconOnly ? t("common.safety.button") : undefined}
        onClick={() => setOpen(true)}
        className={cn("text-foreground", className)}
      >
        <ShieldAlert className="text-destructive" />
        {iconOnly ? null : t("common.safety.button")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) reset()
          setOpen(next)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="flex flex-col gap-5">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--destructive)_15%,transparent)] text-destructive">
                  <ShieldAlert className="size-5" />
                </span>
                <DialogTitle>{t("common.safety.title")}</DialogTitle>
              </div>
              <DialogDescription>{t("common.safety.body")}</DialogDescription>
            </DialogHeader>

            {context ? (
              <p className="text-xs text-muted-foreground">
                {t("common.safety.screen")}:{" "}
                <span className="font-mono text-foreground/85">{context}</span>
              </p>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label>{t("common.safety.category")}</Label>
              <div role="radiogroup" className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((key) => {
                  const active = key === category
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setCategory(key)}
                      className={cn(
                        "h-8 rounded-full px-3 text-[0.8125rem] font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-surface-raised text-foreground/85 hover:text-foreground"
                      )}
                    >
                      {t(`common.safety.categories.${key}`)}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="safety-details">{t("common.safety.details")}</Label>
              <Textarea
                id="safety-details"
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                placeholder={t("common.safety.detailsPlaceholder")}
                className="min-h-24"
              />
            </div>

            <label className="flex items-center gap-2.5 text-[0.8125rem]">
              <Checkbox
                checked={anonymous}
                onCheckedChange={(checked) => setAnonymous(!!checked)}
              />
              {t("common.safety.anonymous")}
            </label>

            <DialogFooter className="items-center sm:justify-between">
              <SimulatedBadge />
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="neutral"
                  onClick={() => {
                    reset()
                    setOpen(false)
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={!details.trim()}>
                  {t("common.safety.submit")}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
