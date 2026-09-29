/**
 * Test picker helpers: the body part of an imaging test, the common OPD tests
 * offered as one-tap chips, and a text search over the catalogue (relevance,
 * then alphabetical).
 */

import type { LabTestRow } from "@/core/db/schema"
import { textScore } from "@/core/search/medicines"

const BODY_PART: Record<string, string> = {
  "XR-CHEST": "Chest",
  "XR-LSS": "Lumbosacral spine",
  "XR-KNEE": "Knee joint",
  "XR-PNS": "Paranasal sinuses",
  "USG-WA": "Whole abdomen",
  "USG-LA": "Lower abdomen",
  "USG-PREG": "Pregnancy profile",
  "USG-KUB": "Kidneys, ureters and bladder",
  "USG-THY": "Thyroid",
  ECG: "Heart (12-lead)",
  ECHO: "Heart",
}

export function bodyPartOf(test: Pick<LabTestRow, "code" | "name">): string {
  return BODY_PART[test.code] ?? test.name
}

/** Test codes shown as quick picks on the orders card (a fixed list, not a ranking). */
export const COMMON_TEST_CODES = [
  "CBC",
  "ESR",
  "CRP",
  "RBS",
  "HBA1C",
  "CREAT",
  "LIPID",
  "URE",
  "XR-CHEST",
  "ECG",
]

/** Tests matching a query by code, name or Bangla gloss: relevance first, then A to Z. */
export function searchTests(
  query: string,
  tests: LabTestRow[],
  limit = 12
): LabTestRow[] {
  const q = query.trim()
  if (!q) return []
  return tests
    .map((test) => ({
      test,
      score: Math.max(
        textScore(q, test.code) + 5,
        textScore(q, test.name),
        test.glossBn ? textScore(q, test.glossBn) : 0
      ),
    }))
    .filter((hit) => hit.score > 5)
    .sort((a, b) => b.score - a.score || a.test.name.localeCompare(b.test.name))
    .slice(0, limit)
    .map((hit) => hit.test)
}
