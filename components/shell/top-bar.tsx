"use client"

import * as React from "react"
import { Search } from "lucide-react"

import { ClockChip } from "@/components/shell/clock-chip"
import { DemoPanelTrigger } from "@/components/shell/demo/demo-panel"
import { EventStreamTrigger } from "@/components/shell/demo/event-stream"
import { Greeting } from "@/components/shell/greeting"
import { NetworkBadge } from "@/components/shell/network"
import { NotificationsButton } from "@/components/shell/notifications"
import { PersonaSwitcher } from "@/components/shell/persona-switcher"
import { LanguageToggle, ThemeToggle } from "@/components/shell/toggles"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { PersonaSeed } from "@/core/seed/content/personas"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/**
 * The global search field. A placeholder in this release: it takes input but
 * does not search yet (the command palette, Cmd/Ctrl+K, finds screens and
 * personas).
 */
export function GlobalSearch({ className }: { className?: string }) {
  const { t } = useLocale()
  return (
    <label
      data-slot="global-search"
      className={cn(
        "relative flex h-11 min-w-0 items-center rounded-md border border-transparent bg-card shadow-(--card-shadow) transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/20",
        className
      )}
    >
      <Search className="pointer-events-none absolute left-3.5 size-[1.125rem] text-muted-foreground" />
      <input
        type="search"
        placeholder={t("shell.searchPlaceholder")}
        aria-label={t("shell.searchPlaceholder")}
        className="h-full w-full min-w-0 bg-transparent pr-3 pl-10 text-sm text-foreground outline-none placeholder:truncate placeholder:text-muted-foreground"
      />
    </label>
  )
}

/** Narrow top bars show a search button that opens the same field. */
function SearchButton({ className }: { className?: string }) {
  const { t } = useLocale()
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t("common.search")}
            title={t("common.search")}
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-md bg-card text-foreground shadow-(--card-shadow) transition-colors outline-none hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-ring/40",
              className
            )}
          />
        }
      >
        <Search className="size-[1.125rem]" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))] p-2">
        <GlobalSearch className="w-full shadow-none" />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The staff top bar (docs/ui_guidelines.md §3), left to right: greeting and
 * context line, search, demo clock, network, event stream, demo panel,
 * notifications, EN/বাং, theme, and the persona switcher. It adapts to its own
 * width, so a 960x600 window keeps every control.
 */
export function TopBar({ persona }: { persona: PersonaSeed }) {
  return (
    <header
      data-slot="top-bar"
      className="@container/topbar relative z-20 flex h-[4.75rem] shrink-0 items-center gap-3 px-4 xl:px-6 print:hidden"
    >
      <Greeting persona={persona} className="min-w-[8rem] flex-1" />
      <GlobalSearch className="hidden w-[20rem] shrink @min-[70rem]/topbar:flex @min-[96rem]/topbar:w-[26rem]" />
      <div className="flex shrink-0 items-center gap-1.5 @min-[60rem]/topbar:gap-2">
        <SearchButton className="@min-[70rem]/topbar:hidden" />
        <ClockChip />
        <NetworkBadge />
        <EventStreamTrigger />
        <DemoPanelTrigger />
        <NotificationsButton />
        <LanguageToggle />
        <ThemeToggle />
        <PersonaSwitcher persona={persona} />
      </div>
    </header>
  )
}
