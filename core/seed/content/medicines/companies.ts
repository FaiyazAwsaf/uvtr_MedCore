/**
 * Bangladeshi pharmaceutical manufacturers (real company names). The "about"
 * lines are our own short neutral descriptions written for the demo; nothing
 * here is copied from any drug index.
 */

export type CompanySeed = {
  key: string
  name: string
  shortName: string
  about: string
}

export const PHARMA_COMPANIES: CompanySeed[] = [
  {
    key: "square",
    name: "Square Pharmaceuticals PLC",
    shortName: "Square",
    about:
      "Large Dhaka-based manufacturer with a broad range of tablets, capsules, liquids and injectables.",
  },
  {
    key: "beximco",
    name: "Beximco Pharmaceuticals Ltd",
    shortName: "Beximco",
    about:
      "Manufacturer of oral solids, inhalers and liquids, with a wide hospital and retail range.",
  },
  {
    key: "incepta",
    name: "Incepta Pharmaceuticals Ltd",
    shortName: "Incepta",
    about: "Manufacturer of general medicines, injectables and vaccines.",
  },
  {
    key: "aci",
    name: "ACI Limited",
    shortName: "ACI",
    about:
      "Diversified group with a pharmaceuticals division covering common prescription and consumer medicines.",
  },
  {
    key: "renata",
    name: "Renata PLC",
    shortName: "Renata",
    about:
      "Manufacturer of human medicines with a strong range in gastro, hormones and paediatrics.",
  },
  {
    key: "eskayef",
    name: "Eskayef Pharmaceuticals Ltd",
    shortName: "SK+F",
    about: "Manufacturer of oral, injectable and specialised dosage forms.",
  },
  {
    key: "opsonin",
    name: "Opsonin Pharma Ltd",
    shortName: "Opsonin",
    about:
      "Manufacturer of general medicines for retail and institutional supply.",
  },
  {
    key: "healthcare",
    name: "Healthcare Pharmaceuticals Ltd",
    shortName: "Healthcare",
    about: "Manufacturer known for gastrointestinal and metabolic medicines.",
  },
  {
    key: "aristopharma",
    name: "Aristopharma Ltd",
    shortName: "Aristopharma",
    about: "Manufacturer of vitamins, antibiotics and general medicines.",
  },
  {
    key: "acme",
    name: "The ACME Laboratories Ltd",
    shortName: "ACME",
    about:
      "Manufacturer of respiratory, cardiovascular and pain-relief medicines.",
  },
  {
    key: "drug-international",
    name: "Drug International Ltd",
    shortName: "Drug International",
    about: "Manufacturer of general and specialised medicines.",
  },
  {
    key: "popular",
    name: "Popular Pharmaceuticals Ltd",
    shortName: "Popular",
    about: "Manufacturer with a hospital injectables and general range.",
  },
  {
    key: "radiant",
    name: "Radiant Pharmaceuticals Ltd",
    shortName: "Radiant",
    about: "Manufacturer and licensee of specialised prescription medicines.",
  },
  {
    key: "general",
    name: "General Pharmaceuticals Ltd",
    shortName: "General",
    about: "Manufacturer of oral solids and liquids for the local market.",
  },
  {
    key: "beacon",
    name: "Beacon Pharmaceuticals PLC",
    shortName: "Beacon",
    about: "Manufacturer with oncology, nutrition and general ranges.",
  },
  {
    key: "globe",
    name: "Globe Pharmaceuticals Ltd",
    shortName: "Globe",
    about: "Manufacturer of general prescription medicines.",
  },
  {
    key: "navana",
    name: "Navana Pharmaceuticals PLC",
    shortName: "Navana",
    about: "Manufacturer of general medicines and nutritional products.",
  },
  {
    key: "orion",
    name: "Orion Pharma Ltd",
    shortName: "Orion",
    about: "Manufacturer of oral and injectable medicines.",
  },
  {
    key: "unimed",
    name: "UniMed UniHealth Pharmaceuticals Ltd",
    shortName: "UniMed UniHealth",
    about: "Manufacturer focused on metabolic and cardiovascular medicines.",
  },
  {
    key: "ziska",
    name: "Ziska Pharmaceuticals Ltd",
    shortName: "Ziska",
    about: "Manufacturer of general prescription and consumer medicines.",
  },
  {
    key: "nipro-jmi",
    name: "Nipro JMI Pharma Ltd",
    shortName: "Nipro JMI",
    about: "Manufacturer of injectables and infusion products.",
  },
  {
    key: "sun-bd",
    name: "Sun Pharmaceutical (Bangladesh) Ltd",
    shortName: "Sun Pharma BD",
    about: "Local unit of an international manufacturer.",
  },
  {
    key: "delta",
    name: "Delta Pharma Ltd",
    shortName: "Delta",
    about: "Manufacturer of general medicines for the local market.",
  },
  {
    key: "asiatic",
    name: "Asiatic Laboratories Ltd",
    shortName: "Asiatic",
    about: "Manufacturer of general and paediatric medicines.",
  },
  {
    key: "smc",
    name: "SMC Enterprise Ltd",
    shortName: "SMC",
    about: "Maker of oral rehydration salts and family health products.",
  },
]

export const companyId = (key: string) => `pc_${key.replace(/-/g, "_")}`
