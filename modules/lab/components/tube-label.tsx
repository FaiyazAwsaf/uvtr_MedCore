"use client"

import { Barcode } from "@/components/shared/barcode"
import { PrintLayout } from "@/components/shared/print-layout"
import { ageOn, dhakaDate } from "@/core/clock/dates"
import type { LabTestRow, PatientRow, SpecimenRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"

/**
 * The tube label (70 x 45 mm): patient, UHID, age and sex, the accession
 * barcode (Code128, Latin digits), container, test codes and collection time.
 * Printing is simulated: the label printer connector just records the print.
 */
export function TubeLabel({
  specimen,
  patient,
  tests,
}: {
  specimen: SpecimenRow
  patient: PatientRow | undefined
  tests: LabTestRow[]
}) {
  const { t, tk, time, dmy, num } = useLocale()
  const at =
    specimen.collectedAt ?? specimen.labelPrintedAt ?? specimen.createdAt
  const age = patient ? ageOn(patient.dob, dhakaDate(at)) : undefined
  return (
    <PrintLayout
      size="label"
      showBrand={false}
      demoFooter={false}
      className="shadow-md"
    >
      <div
        className="flex h-full flex-col gap-1 leading-tight"
        data-testid="tube-label"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[0.75rem] font-bold">
            {patient?.nameEn ?? "-"}
          </span>
          <span className="shrink-0 text-[0.625rem]">
            {age !== undefined && patient
              ? `${t("common.years", { count: num(age) })} ${t(`common.sexShort.${patient.sex}`)}`
              : ""}
          </span>
        </div>
        <div className="text-[0.625rem]">
          {t("common.uhid")}{" "}
          <span className="font-mono">{patient?.uhid ?? "-"}</span>
        </div>
        <Barcode
          value={specimen.accessionNo}
          height={34}
          barWidth={1.25}
          fontSize={11}
          plate={false}
        />
        <div className="flex items-center justify-between gap-2 text-[0.5625rem]">
          <span className="truncate">
            {tk(`lab.containers.${specimen.container}`)} ·{" "}
            {tests.map((x) => x.code).join(", ")}
          </span>
          <span className="shrink-0">
            {t("lab.label.collect")} {dmy(at)} {time(at)}
          </span>
        </div>
      </div>
    </PrintLayout>
  )
}
