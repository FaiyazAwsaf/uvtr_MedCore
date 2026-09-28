"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useLocale } from "@/lib/i18n/provider"

import { CriticalTab, useCriticals } from "./critical-tab"
import { LabPage } from "./lab-ui"
import { ReportsTab } from "./reports-tab"
import { SignoffTab } from "./signoff-tab"
import { useBranch, useLabTests, useStageCounts } from "./use-lab-data"

const TABS = ["signoff", "released", "critical"] as const
type Tab = (typeof TABS)[number]

function CountBadge({ count }: { count: number | undefined }) {
  const { num } = useLocale()
  if (!count) return null
  return (
    <span className="nums inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[0.6875rem] font-semibold text-[#2a2410]">
      {num(count)}
    </span>
  )
}

/**
 * "/pathology": the pathologist's screen (plan §9): the sign-off queue by
 * order (sign and release, or held for payment), released reports (print,
 * verify, correct to a new version) and critical results with the call log.
 * `?tab=released` and `?tab=critical` deep-link for the scenario launchers.
 */
export function PathologyScreen() {
  const { t } = useLocale()
  const branch = useBranch()
  const tests = useLabTests()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const fromUrl = params.get("tab")
  const tab: Tab = TABS.includes(fromUrl as Tab) ? (fromUrl as Tab) : "signoff"
  const counts = useStageCounts(branch)
  const criticals = useCriticals(branch)
  const uncalled = criticals?.filter((c) => !c.calls.length).length

  const setTab = (next: Tab) => {
    const query = new URLSearchParams(params.toString())
    if (next === "signoff") query.delete("tab")
    else query.set("tab", next)
    const qs = query.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <LabPage
      branch={branch}
      title={t("lab.signoff.title")}
      subtitle={t("lab.signoff.subtitle")}
      strip={false}
      testId="pathology"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        className="gap-4"
      >
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="signoff" data-testid="pathology-tab-signoff">
            {t("lab.signoff.tabs.queue")}
            <CountBadge count={counts?.sign} />
          </TabsTrigger>
          <TabsTrigger value="released" data-testid="pathology-tab-released">
            {t("lab.signoff.tabs.released")}
          </TabsTrigger>
          <TabsTrigger value="critical" data-testid="pathology-tab-critical">
            {t("lab.signoff.tabs.critical")}
            <CountBadge count={uncalled} />
          </TabsTrigger>
        </TabsList>
        <TabsContent value="signoff">
          <SignoffTab branch={branch} />
        </TabsContent>
        <TabsContent value="released">
          <ReportsTab branch={branch} />
        </TabsContent>
        <TabsContent value="critical">
          <CriticalTab branch={branch} tests={tests} />
        </TabsContent>
      </Tabs>
    </LabPage>
  )
}
