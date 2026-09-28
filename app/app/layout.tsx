import type { Metadata } from "next"

import { PatientAppShell } from "@/components/shell/patient-app-shell"
import { hospital } from "@/config/brand.config"
import { PatientApp } from "@/modules/patient-app/components/patient-app"

/** The tab title and app name come from the hospital brand, never UVTR (plan §11). */
export const metadata: Metadata = {
  title: hospital.name.en,
  applicationName: hospital.shortName.en,
  description: hospital.name.en,
  authors: [],
  creator: hospital.name.en,
  publisher: hospital.name.en,
}

/**
 * The white-label patient app (plan §9 `/app/*`): City Care branding from
 * brand.config inside a phone frame, never UVTR-branded (plan §11). The shell
 * draws the frame and the patient-only guard; PatientApp runs first launch,
 * the OTP sign-in and the signed-in chrome around every screen.
 */
export default function PatientAppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <PatientAppShell>
      <PatientApp>{children}</PatientApp>
    </PatientAppShell>
  )
}
