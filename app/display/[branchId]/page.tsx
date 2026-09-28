import { DisplayBoard } from "@/modules/queue/components/display-board"

/** "/display/[branchId]": the queue display board (TV), token numbers only. */
export default async function DisplayPage({
  params,
}: {
  params: Promise<{ branchId: string }>
}) {
  const { branchId } = await params
  return <DisplayBoard branchId={branchId} />
}
