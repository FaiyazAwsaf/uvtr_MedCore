import { StaffShell } from "@/components/shell/staff-shell"

/**
 * Every staff route: sidebar, top bar, offline banner, content, command
 * palette and cue card, with the persona and role guard (plan §3.10). The
 * page transition lives in template.tsx.
 */
export default function StaffLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <StaffShell>{children}</StaffShell>
}
