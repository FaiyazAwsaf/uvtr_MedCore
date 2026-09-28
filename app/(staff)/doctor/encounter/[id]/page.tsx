import { EncounterScreen } from "@/modules/consultation/components/encounter/encounter-screen"

/** "/doctor/encounter/[id]": the consultation (plan §9). */
export default async function EncounterPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <EncounterScreen encounterId={id} />
}
