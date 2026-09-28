"use client"

import * as React from "react"

import { usePersona } from "@/core/session/persona"

import { useAppState } from "../state/app-state"
import { AppChrome } from "./app-chrome"
import { AppLoading } from "./bits"
import { DirectoryProvider, FamilyProvider } from "./data"
import { LaunchScreen } from "./launch-screen"
import { OtpLogin } from "./otp-login"
import { PhoneRoot } from "./phone"

/**
 * The white-label patient app inside the shell's phone frame (plan §9
 * `/app/*`). Per window: first launch (hospital splash and language), then
 * the simulated OTP sign-in, then the app for the signed-in account and the
 * family member picked in the switcher. The shell has already checked that
 * this window's persona is a patient.
 */
export function PatientApp({ children }: { children: React.ReactNode }) {
  const persona = usePersona()
  const { launched, signedInAs } = useAppState()
  const accountId = persona?.patientId

  let screen: React.ReactNode
  if (!accountId) screen = <AppLoading />
  else if (!launched) screen = <LaunchScreen />
  else if (signedInAs !== accountId) screen = <OtpLogin accountId={accountId} />
  else
    screen = (
      <FamilyProvider accountId={accountId} loading={<AppLoading />}>
        <DirectoryProvider loading={<AppLoading />}>
          <AppChrome>{children}</AppChrome>
        </DirectoryProvider>
      </FamilyProvider>
    )

  return (
    <PhoneRoot className="flex min-h-full flex-none flex-col">
      {screen}
    </PhoneRoot>
  )
}
