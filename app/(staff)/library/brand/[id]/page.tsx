import { Suspense } from "react"

import { BrandPage } from "@/modules/medicine-library/components/brand-page"
import { routeId } from "@/modules/medicine-library/paths"

/** "/library/brand/[id]": one brand, with staff stock and offers (plan §9). */
export default async function LibraryBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense>
      <BrandPage id={routeId(id)} />
    </Suspense>
  )
}
