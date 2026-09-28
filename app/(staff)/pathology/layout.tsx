import { LabFeedbackHost } from "@/modules/lab/components/lab-feedback"

/** Pathology routes: the page plus the lab rule dialog (LAB_* codes). */
export default function PathologyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {children}
      <LabFeedbackHost />
    </>
  )
}
