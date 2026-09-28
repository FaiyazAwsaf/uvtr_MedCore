"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { MessageSquareText, PhoneCall, ShieldCheck, Smartphone } from "lucide-react"

import { HospitalWordmark } from "@/components/shared/hospital-brand"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { hospital } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"

import { isBdMobile, samePhone } from "../lib/phone"
import { updateAppState } from "../state/app-state"
import { PhoneBanner } from "./phone"

const OTP = rules.simulated.otp

/**
 * OTP sign-in (plan §3.13: simulated, the code is always 123456). The phone is
 * prefilled with the account holder's registered number; "Send code" drops a
 * simulated SMS banner into the phone; the verified login is remembered for
 * this window only.
 */
export function OtpLogin({ accountId }: { accountId: Id }) {
  const { t, locale } = useLocale()
  const db = useDb()
  const account = useLiveQuery(() => db.patients.get(accountId), [db, accountId])

  const [typed, setTyped] = React.useState<string | null>(null)
  const [step, setStep] = React.useState<"phone" | "code">("phone")
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [smsOpen, setSmsOpen] = React.useState(false)
  const [smsKey, setSmsKey] = React.useState(0)
  const codeRef = React.useRef<HTMLInputElement>(null)

  const phone = typed ?? account?.phone ?? ""
  const hospitalName = hospital.shortName[locale]

  const send = () => {
    if (!isBdMobile(phone)) return setError(t("patientApp.login.invalidPhone"))
    if (!samePhone(phone, account?.phone)) {
      return setError(t("patientApp.login.unknownPhone", { hospital: hospitalName }))
    }
    setError(null)
    setCode("")
    setStep("code")
    setSmsKey((key) => key + 1)
    setSmsOpen(true)
    window.setTimeout(() => codeRef.current?.focus(), 50)
  }

  const verify = () => {
    if (code.trim() !== OTP) return setError(t("patientApp.login.wrongCode"))
    setSmsOpen(false)
    updateAppState({ signedInAs: accountId, memberId: accountId })
  }

  const closeSms = React.useCallback(() => setSmsOpen(false), [])

  return (
    <div className="flex min-h-full flex-1 flex-col px-6 pt-6 pb-8">
      <HospitalWordmark short size={36} />

      <div className="mt-9">
        <h1 className="text-[1.625rem] leading-tight font-semibold">
          {t("patientApp.login.title")}
        </h1>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-muted-foreground">
          {t("patientApp.login.subtitle")}
        </p>
      </div>

      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (step === "phone") send()
          else verify()
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-[0.8125rem] font-medium">{t("patientApp.login.phoneLabel")}</span>
          <span className="relative">
            <Smartphone className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="app-otp-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              lang="en"
              value={phone}
              disabled={step === "code"}
              onChange={(event) => {
                setTyped(event.target.value)
                setError(null)
              }}
              className="h-12 pl-11 font-mono text-base tracking-wide"
            />
          </span>
        </label>

        {step === "phone" ? (
          <Button data-testid="app-otp-send" type="submit" size="lg" className="h-12 w-full text-base">
            <MessageSquareText />
            {t("patientApp.login.sendCode")}
          </Button>
        ) : (
          <>
            <label className="flex flex-col gap-2">
              <span className="text-[0.8125rem] font-medium">
                {t("patientApp.login.codeSentTo", { phone })}
              </span>
              <Input
                ref={codeRef}
                data-testid="app-otp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                lang="en"
                maxLength={6}
                value={code}
                aria-label={t("patientApp.login.codeLabel")}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  setError(null)
                }}
                className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
              />
            </label>
            {code !== OTP ? (
              <button
                type="button"
                onClick={() => setCode(OTP)}
                className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-surface-raised px-4 text-[0.8125rem] font-medium"
              >
                <MessageSquareText className="size-4 text-link" />
                {t("patientApp.login.autofill", { code: OTP })}
              </button>
            ) : null}
            <Button
              data-testid="app-otp-verify"
              type="submit"
              size="lg"
              disabled={code.length < 6}
              className="h-12 w-full text-base"
            >
              <ShieldCheck />
              {t("patientApp.login.verify")}
            </Button>
            <div className="flex items-center justify-between text-[0.8125rem]">
              <button type="button" onClick={send} className="min-h-10 font-medium text-link">
                {t("patientApp.login.resend")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("phone")
                  setSmsOpen(false)
                  setError(null)
                }}
                className="min-h-10 font-medium text-link"
              >
                {t("patientApp.login.changeNumber")}
              </button>
            </div>
          </>
        )}

        {error ? (
          <p role="alert" className="text-[0.8125rem] font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </form>

      <div className="mt-auto flex flex-col gap-3 pt-8">
        <div className="rounded-2xl bg-surface-raised p-4">
          <p className="flex items-center gap-2 text-[0.8125rem] font-semibold">
            <ShieldCheck className="size-4 text-link" />
            {t("patientApp.login.privacyTitle")}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {hospital.privacyNotice[locale]}
          </p>
        </div>
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <PhoneCall className="size-3.5" />
          {t("patientApp.login.helpline")}
          <span lang="en" className="font-mono">
            {hospital.helpline}
          </span>
        </p>
      </div>

      <PhoneBanner
        key={smsKey}
        open={smsOpen}
        onClose={closeSms}
        onOpen={() => setCode(OTP)}
        durationMs={12000}
        testId="app-otp-sms"
        icon={
          <span className="flex size-full items-center justify-center bg-success text-white">
            <MessageSquareText className="size-5" />
          </span>
        }
        title={
          <span className="flex items-center gap-2">
            {t("patientApp.login.smsSender")}
            <SimulatedBadge className="h-5" />
          </span>
        }
        meta={t("patientApp.push.now")}
      >
        {t("patientApp.login.smsBody", { hospital: hospitalName, code: OTP })}
      </PhoneBanner>
    </div>
  )
}
