/**
 * Stable ids and values of seeded records that scenario launchers, jump
 * launchers and tests refer to. HERO (hero-ids.ts) covers the main journey;
 * this file covers the scenario master data (plan §10) and the planted states
 * (plan §7.1). The seed creates every id listed here.
 */

export const SEED_REFS = {
  patient: {
    /** S1: the existing record; the form is prefilled with the "Mohammad" variant */
    rafiqul: "pat_rafiqul_islam",
    /** S7: 67 F with CKD; K+ 6.8 */
    jahanara: "pat_jahanara_begum",
    /** S8: TSH report v1 with a unit error */
    shahidul: "pat_shahidul_alam",
    /** S9: three paid tests at different stages */
    nasima: "pat_nasima_khatun",
    /** S10: USG paid by bKash, refund to original tender */
    kamrul: "pat_kamrul_hasan",
    /** Second NID-collision record (NID reuse attempt, S15 style) */
    shahnaz: "pat_shahnaz_parvin",
  },

  /** S1 form values */
  s1: {
    existingPatientId: "pat_rafiqul_islam",
    existingNameEn: "Md. Rafiqul Islam",
    variantNameEn: "Mohammad Rafiqul Islam",
    variantNameBn: "মোহাম্মদ রফিকুল ইসলাম",
    dob: "1978-03-12",
    /** A different phone for the prefilled form */
    variantPhone: "01819-406233",
  },

  /**
   * Existing active records whose NID a presenter can try to reuse: the
   * attempt must hit the INV-02 hard block. Neither NID is duplicated in the
   * seeded data.
   */
  nidCollisions: [
    { patientId: "pat_rafiqul_islam", nid: "4153079826" },
    { patientId: "pat_shahnaz_parvin", nid: "5102334817" },
  ],

  /** The 8 planted fuzzy duplicates: [original, spelling variant], same DOB */
  fuzzyDuplicates: [
    ["pat_dup_kashem_a", "pat_dup_kashem_b"],
    ["pat_dup_rahima_a", "pat_dup_rahima_b"],
    ["pat_dup_shafiqul_a", "pat_dup_shafiqul_b"],
    ["pat_dup_nurjahan_a", "pat_dup_nurjahan_b"],
    ["pat_dup_abdur_a", "pat_dup_abdur_b"],
    ["pat_dup_sharmin_a", "pat_dup_sharmin_b"],
    ["pat_dup_hasna_a", "pat_dup_hasna_b"],
    ["pat_dup_tanjila_a", "pat_dup_tanjila_b"],
  ] as const,

  /** Brand ids used by the planted stock states and scenarios */
  brand: {
    /** Below reorder level at B1 (S12 orders it on PO-1042) */
    napa500: "brd_napa_500mg",
    /** Out at B1, in stock at B3 (S2) */
    zimax500: "brd_zimax_500mg",
    zimax250: "brd_zimax_250mg",
    azithrocin500: "brd_azithrocin_500mg",
    /** Out at B1 (S4 substitution) */
    monas10: "brd_monas_10mg",
    montair10: "brd_montair_10mg",
    lumona10: "brd_lumona_10mg",
    /** Only 14 units at B1 (S3 partial dispense) */
    seclo20: "brd_seclo_20mg",
    /** Hero current medicines */
    comet500: "brd_comet_500mg",
    camlodin5: "brd_camlodin_5mg",
    /** Common hero-consult picks */
    fexo120: "brd_fexo_120mg",
    alatrol10: "brd_alatrol_10mg",
    moxacil500: "brd_moxacil_500mg",
    ace500: "brd_ace_500mg",
  },

  generic: {
    paracetamol: "gen_paracetamol",
    azithromycin: "gen_azithromycin",
    amoxicillin: "gen_amoxicillin",
    montelukast: "gen_montelukast",
    omeprazole: "gen_omeprazole",
    metformin: "gen_metformin",
    amlodipine: "gen_amlodipine",
  },

  /** Lab and imaging catalogue ids */
  test: {
    cbc: "lt_cbc",
    esr: "lt_esr",
    crp: "lt_crp",
    rbs: "lt_rbs",
    electrolytes: "lt_elec",
    potassium: "lt_k",
    creatinine: "lt_creat",
    tsh: "lt_tsh",
    lipid: "lt_lipid",
    hba1c: "lt_hba1c",
    urineRe: "lt_ure",
    xrayChest: "lt_xr_chest",
    usgWholeAbdomen: "lt_usg_wa",
    ecg: "lt_ecg",
    echo: "lt_echo",
  },

  /** Planted batches (visible at B1 pharmacy and store) */
  batch: {
    nearExpiryFexo120: "bat_fexo_120mg_ne",
    nearExpiryAlatrol10: "bat_alatrol_10mg_ne",
    expiredAce500: "bat_ace_500mg_exp",
  },

  room: {
    kamal: "rm_B1_c3",
    arif: "rm_B1_c5",
    nazmul: "rm_B3_c2",
  },

  /** Today's sessions (ids are fixed; the date is always the seed day) */
  session: {
    kamalToday: "ses_kamal_today",
    arifToday: "ses_arif_today",
    nazmulToday: "ses_nazmul_today",
  },

  vendor: {
    /** Napa's manufacturer depot: the S12 PO-1042 vendor */
    beximcoDepot: "ven_beximco",
    squareDepot: "ven_square",
  },

  corporateClient: {
    brightloom: "corp_brightloom",
    kestrel: "corp_kestrel",
    bluewave: "corp_bluewave",
  },

  /** Last seeded purchase order; the counter makes the next one PO-1042 */
  lastPoNo: "PO-1041",
} as const
