"use client"

import * as React from "react"
import { Bell, BellOff } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Notifications button. A placeholder in this release: staff alerts arrive
 * through the event stream and the worklists; this shows the empty state.
 */
export function NotificationsButton({ className }: { className?: string }) {
  const { t } = useLocale()
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t("shell.notifications")}
            title={t("shell.notifications")}
            data-slot="notifications"
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-md bg-card text-foreground shadow-(--card-shadow) transition-colors outline-none hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-ring/40",
              className
            )}
          />
        }
      >
        <Bell className="size-[1.125rem]" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="border-b border-hairline px-4 py-3 text-[0.9375rem] font-semibold">
          {t("shell.notifications")}
        </div>
        <EmptyState icon={BellOff} title={t("shell.noNotifications")} size="sm" />
      </PopoverContent>
    </Popover>
  )
}
