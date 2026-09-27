import { PatientAppShell } from "@/components/shell/patient-app-shell"

/**
 * The white-label patient app (plan §9 `/app/*`): City Care branding from
 * brand.config inside a phone frame, never UVTR-branded (plan §11).
 */
export default function PatientAppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <PatientAppShell>{children}</PatientAppShell>
}
