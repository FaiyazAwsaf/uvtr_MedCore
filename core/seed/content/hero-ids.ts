/**
 * Fixed ids for records the demo story, personas and scenario launchers refer
 * to by name. The seed MUST create these rows with exactly these ids.
 */
export const HERO = {
  household: { karim: "hh_karim" },
  patient: {
    abdulKarim: "pat_abdul_karim",
    rokeyaBegum: "pat_rokeya_begum",
    tanvirKarim: "pat_tanvir_karim",
    nusratKarim: "pat_nusrat_karim",
  },
  /** DoctorRow ids (StaffRow ids are in personas.ts) */
  doctor: {
    kamal: "doc_kamal_hossain",
    arif: "doc_arif_rahman",
    saiful: "doc_saiful_islam",
    nazmul: "doc_nazmul_haque",
    mizanur: "doc_mizanur_rahman",
  },
  karimPhone: "01711-523418",
} as const
