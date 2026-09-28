import { LabFeedbackHost } from "@/modules/lab/components/lab-feedback"

/** Lab routes: the page plus the lab rule dialog (LAB_* codes). */
export default function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <LabFeedbackHost />
    </>
  )
}
