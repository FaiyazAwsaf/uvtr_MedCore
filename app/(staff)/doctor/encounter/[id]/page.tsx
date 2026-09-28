import { EncounterScreen } from "@/modules/consultation/components/encounter/encounter-screen"

/**
 * "/doctor/encounter/[id]": the consultation (plan §9). `?addBrand=<brandId>`
 * (from the medicine library's "Add to prescription") opens that brand on the
 * Rx pad.
 */
export default async function EncounterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ addBrand?: string | string[] }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const addBrand = Array.isArray(query.addBrand)
    ? query.addBrand[0]
    : query.addBrand
  return <EncounterScreen encounterId={id} addBrandId={addBrand} />
}
