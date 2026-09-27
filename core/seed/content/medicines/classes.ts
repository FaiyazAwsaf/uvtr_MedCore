/**
 * Drug classes for the library's class pages and typeahead. `keys` are the
 * extra search words for the class, including the common abbreviations staff
 * type ("ppi", "nsaid", "arb").
 */

export type DrugClassSeed = {
  key: string
  name: string
  parent?: string
  keys: string[]
}

export const DRUG_CLASSES: DrugClassSeed[] = [
  /* Top-level groups */
  {
    key: "analgesics",
    name: "Analgesics and antipyretics",
    keys: ["analgesic", "painkiller", "antipyretic"],
  },
  {
    key: "anti-infectives",
    name: "Anti-infectives",
    keys: ["antibiotic", "antimicrobial", "anti-infective"],
  },
  { key: "gastro", name: "Gastrointestinal medicines", keys: ["gastro", "gi"] },
  {
    key: "respiratory",
    name: "Respiratory and allergy medicines",
    keys: ["respiratory", "allergy"],
  },
  {
    key: "cardio",
    name: "Cardiovascular medicines",
    keys: ["cardiac", "cardiovascular", "heart"],
  },
  {
    key: "endocrine",
    name: "Endocrine and metabolic medicines",
    keys: ["endocrine", "metabolic"],
  },
  {
    key: "cns",
    name: "Central nervous system medicines",
    keys: ["cns", "neuro", "psychiatric"],
  },
  {
    key: "vitamins",
    name: "Vitamins and minerals",
    keys: ["vitamin", "mineral", "supplement"],
  },
  {
    key: "derma",
    name: "Dermatological preparations",
    keys: ["skin", "topical", "derma"],
  },

  /* Analgesics */
  {
    key: "non-opioid",
    name: "Non-opioid analgesics",
    parent: "analgesics",
    keys: ["fever", "pain"],
  },
  {
    key: "nsaid",
    name: "Non-steroidal anti-inflammatory drugs (NSAIDs)",
    parent: "analgesics",
    keys: ["nsaid", "nsaids", "anti-inflammatory"],
  },
  {
    key: "opioid",
    name: "Opioid analgesics",
    parent: "analgesics",
    keys: ["opioid", "narcotic"],
  },

  /* Anti-infectives */
  {
    key: "penicillin",
    name: "Penicillins",
    parent: "anti-infectives",
    keys: ["penicillin", "beta-lactam"],
  },
  {
    key: "cephalosporin",
    name: "Cephalosporins",
    parent: "anti-infectives",
    keys: ["cephalosporin", "beta-lactam"],
  },
  {
    key: "macrolide",
    name: "Macrolides",
    parent: "anti-infectives",
    keys: ["macrolide"],
  },
  {
    key: "quinolone",
    name: "Fluoroquinolones",
    parent: "anti-infectives",
    keys: ["quinolone", "fluoroquinolone"],
  },
  {
    key: "tetracycline",
    name: "Tetracyclines",
    parent: "anti-infectives",
    keys: ["tetracycline"],
  },
  {
    key: "nitroimidazole",
    name: "Nitroimidazoles",
    parent: "anti-infectives",
    keys: ["nitroimidazole", "antiprotozoal"],
  },
  {
    key: "sulfonamide",
    name: "Sulfonamide combinations",
    parent: "anti-infectives",
    keys: ["sulfonamide", "sulfa"],
  },
  {
    key: "antifungal",
    name: "Antifungals",
    parent: "anti-infectives",
    keys: ["antifungal", "azole"],
  },
  {
    key: "anthelmintic",
    name: "Anthelmintics",
    parent: "anti-infectives",
    keys: ["anthelmintic", "deworming", "worm"],
  },

  /* Gastrointestinal */
  {
    key: "ppi",
    name: "Proton pump inhibitors (PPI)",
    parent: "gastro",
    keys: ["ppi", "proton", "acidity"],
  },
  {
    key: "h2",
    name: "H2 receptor antagonists",
    parent: "gastro",
    keys: ["h2", "h2ra", "acidity"],
  },
  {
    key: "antacid",
    name: "Antacids",
    parent: "gastro",
    keys: ["antacid", "acidity"],
  },
  {
    key: "antiemetic",
    name: "Antiemetics and prokinetics",
    parent: "gastro",
    keys: ["antiemetic", "prokinetic", "vomiting"],
  },
  {
    key: "ors",
    name: "Oral rehydration salts",
    parent: "gastro",
    keys: ["ors", "rehydration", "saline"],
  },
  {
    key: "antispasmodic",
    name: "Antispasmodics",
    parent: "gastro",
    keys: ["antispasmodic", "colic"],
  },

  /* Respiratory and allergy */
  {
    key: "ltra",
    name: "Leukotriene receptor antagonists",
    parent: "respiratory",
    keys: ["ltra", "leukotriene"],
  },
  {
    key: "antihistamine",
    name: "Antihistamines",
    parent: "respiratory",
    keys: ["antihistamine", "allergy"],
  },
  {
    key: "bronchodilator",
    name: "Bronchodilators",
    parent: "respiratory",
    keys: ["bronchodilator", "asthma", "inhaler"],
  },
  {
    key: "ics-laba",
    name: "Inhaled corticosteroid combinations",
    parent: "respiratory",
    keys: ["ics", "laba", "inhaler"],
  },
  {
    key: "mucolytic",
    name: "Mucolytics",
    parent: "respiratory",
    keys: ["mucolytic", "cough"],
  },

  /* Cardiovascular */
  {
    key: "ccb",
    name: "Calcium channel blockers",
    parent: "cardio",
    keys: ["ccb", "calcium channel"],
  },
  {
    key: "arb",
    name: "Angiotensin receptor blockers (ARB)",
    parent: "cardio",
    keys: ["arb", "sartan"],
  },
  {
    key: "beta-blocker",
    name: "Beta blockers",
    parent: "cardio",
    keys: ["beta blocker", "bb"],
  },
  {
    key: "statin",
    name: "Statins",
    parent: "cardio",
    keys: ["statin", "cholesterol", "lipid"],
  },
  {
    key: "antiplatelet",
    name: "Antiplatelets",
    parent: "cardio",
    keys: ["antiplatelet", "blood thinner"],
  },
  { key: "diuretic", name: "Diuretics", parent: "cardio", keys: ["diuretic"] },

  /* Endocrine and metabolic */
  {
    key: "biguanide",
    name: "Biguanides",
    parent: "endocrine",
    keys: ["biguanide", "diabetes"],
  },
  {
    key: "sulfonylurea",
    name: "Sulfonylureas",
    parent: "endocrine",
    keys: ["sulfonylurea", "su", "diabetes"],
  },
  {
    key: "dpp4",
    name: "DPP-4 inhibitors",
    parent: "endocrine",
    keys: ["dpp4", "gliptin", "diabetes"],
  },
  {
    key: "sglt2",
    name: "SGLT2 inhibitors",
    parent: "endocrine",
    keys: ["sglt2", "gliflozin", "diabetes"],
  },
  {
    key: "thyroid",
    name: "Thyroid hormones",
    parent: "endocrine",
    keys: ["thyroid"],
  },
  {
    key: "corticosteroid",
    name: "Systemic corticosteroids",
    parent: "endocrine",
    keys: ["steroid", "corticosteroid"],
  },

  /* CNS */
  {
    key: "benzodiazepine",
    name: "Benzodiazepines",
    parent: "cns",
    keys: ["benzodiazepine", "sedative"],
  },
  {
    key: "antidepressant",
    name: "Antidepressants",
    parent: "cns",
    keys: ["antidepressant", "ssri", "tca"],
  },
  {
    key: "neuropathic",
    name: "Neuropathic pain agents",
    parent: "cns",
    keys: ["neuropathic"],
  },
  {
    key: "vestibular",
    name: "Antimigraine and vestibular agents",
    parent: "cns",
    keys: ["migraine", "vertigo"],
  },

  /* Vitamins and minerals */
  {
    key: "calcium",
    name: "Calcium and vitamin D",
    parent: "vitamins",
    keys: ["calcium", "vitamin d"],
  },
  {
    key: "iron",
    name: "Iron and folic acid",
    parent: "vitamins",
    keys: ["iron", "folic"],
  },
  {
    key: "vit-b",
    name: "Vitamin B complex",
    parent: "vitamins",
    keys: ["vitamin b", "b complex"],
  },
  { key: "zinc", name: "Zinc", parent: "vitamins", keys: ["zinc"] },

  /* Dermatology */
  {
    key: "topical-steroid",
    name: "Topical corticosteroids",
    parent: "derma",
    keys: ["topical steroid", "cream"],
  },
]

export const classId = (key: string) => `cls_${key.replace(/-/g, "_")}`
