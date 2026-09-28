import { PatientAppShell } from "@/components/shell/patient-app-shell"
import { PatientApp } from "@/modules/patient-app/components/patient-app"

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
