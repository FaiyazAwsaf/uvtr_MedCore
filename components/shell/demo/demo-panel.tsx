"use client"

import { FlaskConical, SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDbInfo } from "@/core/db/DbProvider"
import { useLocale } from "@/lib/i18n/provider"
import { EngineCheck } from "@/modules/demo/components/engine-check"
import { useSeedStatus } from "@/modules/demo/components/seed-status"

import { DRAWER_CLASS, INHERIT_FONT } from "./event-stream"
import { ClockSection } from "./panel-clock"
import { DataSection } from "./panel-data"
import { NetworkSection } from "./panel-network"
import { ScenariosSection } from "./panel-scenarios"
import { SectionTitle } from "./section-title"
import { useDemoUi, type PanelTab } from "./store"

const TABS: { value: PanelTab; key: `demo.panel.tabs.${PanelTab}` }[] = [
  { value: "controls", key: "demo.panel.tabs.controls" },
  { value: "scenarios", key: "demo.panel.tabs.scenarios" },
  { value: "engine", key: "demo.panel.tabs.engine" },
  { value: "data", key: "demo.panel.tabs.data" },
]

/**
 * Top-bar button for the demo panel: clock, branch network, scenario
 * launchers, the engine check and demo data (plan §13, WS-Shell). A dot
 * marks the button while a branch is offline or the seed is stale.
 */
export function DemoPanelTrigger() {
  const { t } = useLocale()
  const { network } = useDbInfo()
  const { stale } = useSeedStatus()
  const open = useDemoUi((s) => s.panelOpen)
  const setOpen = useDemoUi((s) => s.setPanelOpen)
  const tab = useDemoUi((s) => s.panelTab)
  const setTab = useDemoUi((s) => s.setPanelTab)
  const attention = stale || network.some((n) => n.status !== "online")

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={t("demo.panel.open")}
            title={t("demo.panel.open")}
            data-testid="demo-panel-trigger"
          />
        }
      >
        <SlidersHorizontal />
        {attention ? (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 size-2 rounded-full bg-warning ring-2 ring-background"
          />
        ) : null}
      </SheetTrigger>
      <SheetContent
        side="right"
        className={DRAWER_CLASS}
        data-testid="demo-panel"
      >
        <SheetHeader className="gap-1 p-4 pr-12 pb-3">
          <SheetTitle className="text-base font-semibold" style={INHERIT_FONT}>
            {t("demo.panel.title")}
          </SheetTitle>
          <SheetDescription>{t("demo.panel.subtitle")}</SheetDescription>
        </SheetHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as PanelTab)}
          className="min-h-0 flex-1 gap-0"
        >
          <TabsList className="mx-4 mb-1 h-8 w-auto shrink-0">
            {TABS.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="px-2 text-[0.6875rem]"
              >
                {t(item.key)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="controls" className="min-h-0 overflow-y-auto p-4">
            <div className="flex flex-col gap-5">
              <ClockSection />
              <NetworkSection />
            </div>
          </TabsContent>
          <TabsContent
            value="scenarios"
            className="min-h-0 overflow-y-auto p-4"
          >
            <ScenariosSection />
          </TabsContent>
          <TabsContent value="engine" className="min-h-0 overflow-y-auto p-4">
            <div className="flex flex-col gap-3">
              <SectionTitle
                icon={FlaskConical}
                title={t("demo.engine.title")}
              />
              <EngineCheck />
            </div>
          </TabsContent>
          <TabsContent value="data" className="min-h-0 overflow-y-auto p-4">
            <DataSection />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
