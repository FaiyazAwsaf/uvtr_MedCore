import { Suspense } from "react"

import { LibraryHome } from "@/modules/medicine-library/components/library-home"

/** "/library": the medicine library search and A to Z browse (plan §9). */
export default function LibraryPage() {
  // The page reads its query and Rx-pad mode from the address (useSearchParams).
  return (
    <Suspense>
      <LibraryHome />
    </Suspense>
  )
}
