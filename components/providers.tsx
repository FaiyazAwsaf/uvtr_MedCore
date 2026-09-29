"use client"

import * as React from "react"
import { Toaster } from "sonner"

import { ThemeProvider } from "@/components/theme-provider"
import { ScenarioUrlLauncher } from "@/components/shell/demo/use-scenario-launcher"
import { EngineFeedbackHost } from "@/components/shell/engine-feedback"
import { UiScaleProvider } from "@/components/shell/ui-scale"
import { TooltipProvider } from "@/components/ui/tooltip"
import { EngineProvider } from "@/core/runtime/EngineProvider"
import { LocaleProvider } from "@/lib/i18n/provider"

/**
 * App-wide providers. Theme, language and interface scale are all per window
 * (the window session), so four windows or four Demo Wall panes can each run
 * their own. The scale is applied outside the engine so the loading screen
 * already has the window's size.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <UiScaleProvider />
        <EngineProvider>
          <TooltipProvider delay={200}>
            {children}
            {/* Once per window: conflict, rule, denial and persona dialogs
                for every page (launcher, Demo Wall and demo panel included). */}
            <EngineFeedbackHost />
            <ScenarioUrlLauncher />
            <Toaster
              position="bottom-right"
              gap={8}
              toastOptions={{
                classNames: {
                  toast:
                    "!gap-2.5 !font-sans !rounded-md !border !border-border !bg-popover !px-4 !py-3 !text-[0.8125rem] !text-popover-foreground !shadow-xl",
                  title: "!font-semibold",
                  description: "!text-muted-foreground",
                  error: "[&_[data-icon]]:!text-destructive",
                  success: "[&_[data-icon]]:!text-success",
                  warning: "[&_[data-icon]]:!text-warning",
                  info: "[&_[data-icon]]:!text-info",
                  actionButton:
                    "!rounded-sm !bg-primary !font-semibold !text-primary-foreground",
                  cancelButton:
                    "!rounded-sm !bg-surface-raised !text-foreground",
                },
              }}
            />
          </TooltipProvider>
        </EngineProvider>
      </LocaleProvider>
    </ThemeProvider>
  )
}
