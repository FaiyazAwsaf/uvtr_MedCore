"use client"

import * as React from "react"
import { Printer } from "lucide-react"

import { Barcode } from "@/components/shared/barcode"
import { ageOf } from "@/components/shared/person"
import { PrintLayout } from "@/components/shared/print-layout"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { now } from "@/core/clock/clock"
import type {
  Diagnosis,
  DoctorRow,
  PatientRow,
  PrescriptionRow,
  StaffRow,
  Vitals,
} from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"
import type { MedicineCatalogRows } from "@/modules/consultation/components/data"
import { cToF } from "@/modules/consultation/components/encounter/vitals-card"

import { useLineName, type LineView } from "./rx-lines"

export type RxPrintData = {
  rx: PrescriptionRow
  lines: LineView[]
  patient: PatientRow
  doctor?: DoctorRow
  doctorStaff?: StaffRow
  vitals?: Vitals
  diagnoses: Diagnosis[]
  tests: string[]
}

/**
 * The printed prescription (objective §3B): A5, hospital brand, branch,
 * doctor with qualifications and BMDC number, patient with UHID, vitals,
 * each medicine as brand, generic, strength and form with the dose pattern
 * and the Bangla dose line (always Bangla, plan §3.11), tests, advice, the
 * follow-up date and a barcode of the Rx number.
 */
export function RxSheet({
  data,
  catalog,
}: {
  data: RxPrintData
  catalog: MedicineCatalogRows | undefined
}) {
  const { t, num, dmy, time, locale, uhid } = useLocale()
  const nameOf = useLineName(catalog)
  const { rx, patient, doctor, doctorStaff, vitals } = data
  const age = ageOf(patient.dob, rx.signedAt ?? now())
  const signed = rx.status !== "draft"
  const v = vitals
  const dash = "-"
  const vitalsText = v
    ? t("prescribing.print.vitalsLine", {
        bp:
          v.bpSys !== undefined && v.bpDia !== undefined
            ? `${num(v.bpSys)}/${num(v.bpDia)}`
            : dash,
        pulse: v.pulse !== undefined ? num(v.pulse) : dash,
        temp:
          v.tempC !== undefined
            ? num(cToF(v.tempC), { maximumFractionDigits: 1 })
            : dash,
        spo2: v.spo2 !== undefined ? num(v.spo2) : dash,
        weight: v.weightKg !== undefined ? num(v.weightKg) : dash,
      })
    : t("prescribing.print.noVitals")

  return (
    <PrintLayout
      size="A5"
      branch={rx.branchId}
      title={t("prescribing.print.title")}
      docNo={rx.rxNo}
      meta={
        <>
          {dmy(rx.signedAt ?? now())} ·{" "}
          {t("prescribing.print.version", { version: rx.rxVersion })}
        </>
      }
      footer={t("prescribing.pad.demoFooter")}
      demoFooter={false}
    >
      <div
        className="relative flex flex-col gap-3 text-[0.75rem]"
        data-testid="rx-print-sheet"
      >
        {!signed ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-12 rounded border-2 border-[#c0392b]/40 px-3 py-1 text-base font-bold text-[#c0392b]/50 uppercase">
              {t("prescribing.print.draftWatermark")}
            </span>
          </div>
        ) : null}

        <div className="flex items-start justify-between gap-4 border-b border-[#ddd] pb-2">
          <div className="min-w-0">
            <div className="text-[0.875rem] font-bold">
              {doctorStaff
                ? locale === "bn"
                  ? doctorStaff.nameBn
                  : doctorStaff.nameEn
                : ""}
            </div>
            <div lang="en">{doctor?.qualifications}</div>
            <div>{doctorStaff?.designation[locale]}</div>
            {doctor ? (
              <div lang="en">
                {t("prescribing.print.bmdc", { no: doctor.bmdcNo })}
              </div>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[0.8125rem] font-semibold">
              {locale === "bn" ? patient.nameBn : patient.nameEn}
            </div>
            <div>
              {t("prescribing.print.age")}:{" "}
              {t(age.unit === "years" ? "common.years" : "common.months", {
                count: num(age.value),
              })}{" "}
              · {t("prescribing.print.sex")}:{" "}
              {t(`common.sexLong.${patient.sex}`)}
            </div>
            <div>
              {t("prescribing.print.uhid")}:{" "}
              <span className="font-mono" lang="en">
                {uhid(patient.uhid)}
              </span>
            </div>
            <div>
              {t("prescribing.print.date")}: {dmy(rx.signedAt ?? now())}
              {rx.signedAt ? `, ${time(rx.signedAt)}` : ""}
            </div>
          </div>
        </div>

        <div>
          <span className="font-semibold">
            {t("prescribing.print.vitals")}:{" "}
          </span>
          {vitalsText}
        </div>

        <div className="grid grid-cols-[34%_1fr] gap-4">
          <div className="flex flex-col gap-3 border-r border-[#ddd] pr-3">
            <div>
              <div className="font-semibold">
                {t("prescribing.print.diagnosis")}
              </div>
              {data.diagnoses.length ? (
                <ul className="mt-0.5 flex flex-col gap-0.5" lang="en">
                  {data.diagnoses.map((d) => (
                    <li key={d.icd10}>
                      {d.label} <span className="text-[#666]">({d.icd10})</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[#666]">-</div>
              )}
            </div>
            <div>
              <div className="font-semibold">
                {t("prescribing.print.tests")}
              </div>
              {data.tests.length ? (
                <ul
                  className="mt-0.5 flex list-disc flex-col gap-0.5 pl-4"
                  lang="en"
                >
                  {data.tests.map((test) => (
                    <li key={test}>{test}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-[#666]">-</div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xl leading-none font-bold italic" lang="en">
              {t("prescribing.print.rx")}
            </div>
            <ol className="flex flex-col gap-2">
              {data.lines.map((line, i) => {
                const n = nameOf(line)
                const brand = n.brand
                return (
                  <li key={line.key} data-testid="rx-print-line">
                    <div className="font-semibold" lang="en">
                      {i + 1}. {n.prefix} {n.name}
                    </div>
                    {brand ? (
                      <div className="text-[0.6875rem] text-[#555]" lang="en">
                        {n.generic} {brand.strength} {brand.form}
                      </div>
                    ) : null}
                    <div
                      className="mt-0.5 text-[0.8125rem]"
                      lang="bn"
                      data-testid="rx-print-bn"
                    >
                      {line.instructionsBn}
                    </div>
                    <div className="text-[0.6875rem] text-[#555]">
                      <span className="font-mono" lang="en">
                        {line.dosePattern}
                      </span>{" "}
                      · {t(`prescribing.dose.meals.${line.mealTiming}`)} ·{" "}
                      {line.durationDays === 0
                        ? t("prescribing.print.continue")
                        : t("prescribing.print.forDays", {
                            count: num(line.durationDays),
                          })}{" "}
                      ·{" "}
                      {t("prescribing.print.qty", {
                        count: num(line.qtyPrescribed),
                      })}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>

        {rx.advice.trim() ? (
          <div>
            <div className="font-semibold">{t("prescribing.print.advice")}</div>
            <p className="whitespace-pre-wrap">{rx.advice}</p>
          </div>
        ) : null}

        {rx.followUpDate ? (
          <div data-testid="rx-print-follow-up">
            <span className="font-semibold">
              {t("prescribing.print.followUp")}:{" "}
            </span>
            {t("prescribing.print.followUpOn", { date: dmy(rx.followUpDate) })}
          </div>
        ) : null}

        <div className="mt-2 flex items-end justify-between gap-4">
          <Barcode
            value={rx.rxNo}
            height={34}
            barWidth={1.2}
            fontSize={10}
            plate={false}
          />
          <div className="min-w-[40%] border-t border-[#999] pt-1 text-center text-[0.6875rem]">
            {t("prescribing.print.signature")}
            {doctorStaff ? (
              <div className="font-semibold">
                {locale === "bn" ? doctorStaff.nameBn : doctorStaff.nameEn}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </PrintLayout>
  )
}

export function RxPrintDialog({
  open,
  onOpenChange,
  data,
  catalog,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: RxPrintData | undefined
  catalog: MedicineCatalogRows | undefined
}) {
  const { t } = useLocale()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] gap-4 sm:max-w-[42rem]"
        data-testid="rx-print-preview"
      >
        <DialogHeader>
          <DialogTitle>{t("prescribing.print.preview")}</DialogTitle>
          <DialogDescription className="font-mono" lang="en">
            {data?.rx.rxNo}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-md bg-[#e9e9ec] p-3">
          {data ? <RxSheet data={data} catalog={catalog} /> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("prescribing.print.close")}
          </Button>
          <Button onClick={() => window.print()} data-testid="rx-print-go">
            <Printer />
            {t("prescribing.print.print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
