import { Suspense } from "react"

import { GenericPage } from "@/modules/medicine-library/components/generic-page"
import { routeId } from "@/modules/medicine-library/paths"

/** "/library/generic/[id]": a generic's monograph and all its brands (plan §9). */
export default async function LibraryGenericPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense>
      <GenericPage id={routeId(id)} />
    </Suspense>
  )
}
