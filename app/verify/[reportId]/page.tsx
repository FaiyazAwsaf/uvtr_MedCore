import { VerifyScreen } from "@/modules/lab/components/verify-screen"

/** "/verify/[reportId]": public QR verification of a report (plan T2.7). */
export default async function Page({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = await params
  return <VerifyScreen reportId={decodeURIComponent(reportId)} />
}
