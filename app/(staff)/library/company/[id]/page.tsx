import { Suspense } from "react"

import { CompanyPage } from "@/modules/medicine-library/components/company-page"
import { routeId } from "@/modules/medicine-library/paths"

/** "/library/company/[id]": a manufacturer and its brands (plan §9). */
export default async function LibraryCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense>
      <CompanyPage id={routeId(id)} />
    </Suspense>
  )
}
