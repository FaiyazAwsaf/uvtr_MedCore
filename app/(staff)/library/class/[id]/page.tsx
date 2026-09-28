import { Suspense } from "react"

import { ClassPage } from "@/modules/medicine-library/components/class-page"
import { routeId } from "@/modules/medicine-library/paths"

/** "/library/class/[id]": a drug class, its generics and brands (plan §9). */
export default async function LibraryClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense>
      <ClassPage id={routeId(id)} />
    </Suspense>
  )
}
