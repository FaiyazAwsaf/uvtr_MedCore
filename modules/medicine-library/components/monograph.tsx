"use client"

import * as React from "react"

import { ReleaseBanner } from "@/components/shared/release-banner"
import { SectionCard } from "@/components/shared/section-card"
import type { GenericRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"

/**
 * A generic's monograph (our own demo text, plan D8): indications, dosage,
 * contraindications, side effects and pregnancy category. Interactions are
 * licensed content planned for Release 2, so they show the Release 2 note
 * instead. Clinical text stays in English in both languages (D13).
 */
export function Monograph({
  generic,
  title,
  subtitle,
  seeAllHref,
  seeAllLabel,
  className,
}: {
  generic: GenericRow
  title: React.ReactNode
  subtitle?: React.ReactNode
  seeAllHref?: string
  seeAllLabel?: React.ReactNode
  className?: string
}) {
  const { t, isBangla } = useLocale()
  const sections: { key: string; label: string; text: string }[] = [
    { key: "indications", label: t("library.monograph.indications"), text: generic.indications },
    { key: "dosage", label: t("library.monograph.dosage"), text: generic.dosage },
    {
      key: "contraindications",
      label: t("library.monograph.contraindications"),
      text: generic.contraindications,
    },
    { key: "side-effects", label: t("library.monograph.sideEffects"), text: generic.sideEffects },
  ]
  return (
    <SectionCard
      title={title}
      subtitle={subtitle}
      size="sm"
      seeAllHref={seeAllHref}
      seeAllLabel={seeAllLabel}
      className={className}
      bodyClassName="flex flex-col gap-4"
    >
      <div data-testid="monograph" className="flex flex-col gap-3.5">
        {sections.map((section) => (
          <section key={section.key} data-section={section.key} className="flex flex-col gap-1">
            <h3 className="text-[0.8125rem] font-semibold">{section.label}</h3>
            <p lang="en" className="text-[0.8125rem] leading-relaxed text-foreground/85">
              {section.text}
            </p>
          </section>
        ))}
        <section data-section="pregnancy" className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-[0.8125rem] font-semibold">{t("library.monograph.pregnancy")}</h3>
          <span className="text-[0.8125rem] text-foreground/85">
            {generic.pregnancyCategory === "N/A"
              ? t("library.monograph.pregnancyNa")
              : t("library.monograph.pregnancyCategory", { category: generic.pregnancyCategory })}
          </span>
        </section>
      </div>
      <ReleaseBanner
        title={t("library.monograph.interactionsTitle")}
        description={t("library.monograph.interactionsBody")}
      />
      {isBangla ? (
        <p className="text-xs text-muted-foreground">{t("library.monograph.englishOnly")}</p>
      ) : null}
    </SectionCard>
  )
}
