/**
 * Runtime reference content for modules (not tables). Import from here, not
 * from the seed generators: these files are small and pure, so they do not
 * pull the seed into the main bundle.
 *
 * - ICD10: diagnosis picker (about 150 common outpatient codes)
 * - NOTE_TEMPLATES: 7 specialty note templates (EN/BN)
 * - DOSE_PATTERNS, MEAL_TIMING, DURATIONS, QUICK_TEXTS, doseInstruction,
 *   courseQuantity: the Rx pad shortcuts ("1+0+1" to Bangla dose words)
 * - SCRIBE_SCRIPTS: the scripted scribe consultations (hero + 2)
 * - ANALYSER_SCRIPTS, TSH_UNIT_ERROR, defaultAnalyserValue, flagFor,
 *   rangeFor: the simulated analyser connector
 * - SEED_REFS, HERO: fixed ids for launchers and tests
 * - nameKeyFor, nameSearchKeys: the patient-name normaliser behind
 *   `patients.nameSearchKeys` (run queries through `nameKeyFor`)
 */

export { ICD10, findIcd10, type Icd10Entry } from "./icd10"
export {
  NOTE_TEMPLATES,
  templateForSpecialty,
  type NoteTemplate,
} from "./note-templates"
export {
  DOSE_PATTERNS,
  DURATIONS,
  MEAL_TIMING,
  QUICK_TEXTS,
  courseQuantity,
  doseInstruction,
  findDosePattern,
  type DosePattern,
  type QuickText,
} from "./dose"
export {
  SCRIBE_SCRIPTS,
  HERO_SCRIBE_SCRIPT_ID,
  type ScribeScript,
} from "./scribe-scripts"
export {
  ANALYSER_SCRIPTS,
  TSH_UNIT_ERROR,
  defaultAnalyserValue,
  findAnalyserScript,
  flagFor,
  rangeFor,
  type AnalyserScript,
} from "./analyser-scripts"
export { SEED_REFS } from "./seed-refs"
export { HERO } from "./hero-ids"
export { bnDigits } from "./bn"
export { nameKeyFor, nameSearchKeys } from "../generators/search-keys"
