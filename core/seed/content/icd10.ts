/**
 * About 150 common outpatient ICD-10 (WHO) codes for the note's diagnosis
 * picker (runtime reference content, not a table). Labels stay English per
 * the translation boundary (plan §3.11) with a short Bangla gloss.
 */

export type Icd10Entry = {
  code: string
  label: string
  glossBn: string
  /** Specialty codes where the entry is commonly used, for picker ordering */
  specialties?: string[]
}

export const ICD10: Icd10Entry[] = [
  /* Infections */
  {
    code: "A01.0",
    label: "Typhoid fever",
    glossBn: "টাইফয়েড জ্বর",
    specialties: ["MED", "PAED"],
  },
  {
    code: "A03.9",
    label: "Shigellosis, unspecified",
    glossBn: "শিগেলোসিস (রক্ত আমাশয়)",
  },
  {
    code: "A06.0",
    label: "Acute amoebic dysentery",
    glossBn: "অ্যামিবিক আমাশয়",
  },
  {
    code: "A08.4",
    label: "Viral intestinal infection, unspecified",
    glossBn: "ভাইরাসজনিত পেটের সংক্রমণ",
    specialties: ["PAED"],
  },
  {
    code: "A09",
    label: "Diarrhoea and gastroenteritis of presumed infectious origin",
    glossBn: "ডায়রিয়া ও পেটের সংক্রমণ",
    specialties: ["MED", "PAED"],
  },
  {
    code: "A15.0",
    label: "Tuberculosis of lung, confirmed",
    glossBn: "ফুসফুসের যক্ষ্মা",
    specialties: ["CHEST"],
  },
  { code: "A75.3", label: "Scrub typhus", glossBn: "স্ক্রাব টাইফাস" },
  {
    code: "A97.0",
    label: "Dengue without warning signs",
    glossBn: "ডেঙ্গু (সতর্ক লক্ষণ ছাড়া)",
    specialties: ["MED", "PAED"],
  },
  {
    code: "A97.1",
    label: "Dengue with warning signs",
    glossBn: "ডেঙ্গু (সতর্ক লক্ষণসহ)",
    specialties: ["MED", "PAED"],
  },
  {
    code: "B01.9",
    label: "Varicella without complication",
    glossBn: "জলবসন্ত",
    specialties: ["PAED", "DERM"],
  },
  {
    code: "B05.9",
    label: "Measles without complication",
    glossBn: "হাম",
    specialties: ["PAED"],
  },
  {
    code: "B07",
    label: "Viral warts",
    glossBn: "আঁচিল",
    specialties: ["DERM"],
  },
  {
    code: "B18.1",
    label: "Chronic viral hepatitis B",
    glossBn: "দীর্ঘমেয়াদি হেপাটাইটিস বি",
    specialties: ["GASTRO"],
  },
  {
    code: "B26.9",
    label: "Mumps without complication",
    glossBn: "মাম্পস",
    specialties: ["PAED"],
  },
  {
    code: "B34.9",
    label: "Viral infection, unspecified",
    glossBn: "ভাইরাস সংক্রমণ",
    specialties: ["MED", "PAED"],
  },
  {
    code: "B35.4",
    label: "Tinea corporis",
    glossBn: "দাদ",
    specialties: ["DERM"],
  },
  {
    code: "B36.0",
    label: "Pityriasis versicolor",
    glossBn: "ছুলি",
    specialties: ["DERM"],
  },
  { code: "B54", label: "Malaria, unspecified", glossBn: "ম্যালেরিয়া" },
  {
    code: "B82.0",
    label: "Intestinal helminthiasis, unspecified",
    glossBn: "পেটে কৃমি",
    specialties: ["PAED"],
  },
  {
    code: "B86",
    label: "Scabies",
    glossBn: "খোসপাঁচড়া",
    specialties: ["DERM", "PAED"],
  },

  /* Blood and endocrine */
  {
    code: "D50.9",
    label: "Iron deficiency anaemia, unspecified",
    glossBn: "আয়রনের অভাবজনিত রক্তস্বল্পতা",
    specialties: ["MED", "GYN"],
  },
  {
    code: "D64.9",
    label: "Anaemia, unspecified",
    glossBn: "রক্তস্বল্পতা",
    specialties: ["MED"],
  },
  {
    code: "D17.9",
    label: "Benign lipomatous neoplasm, unspecified",
    glossBn: "লাইপোমা (চর্বির চাকা)",
    specialties: ["SURG"],
  },
  {
    code: "D25.9",
    label: "Leiomyoma of uterus, unspecified",
    glossBn: "জরায়ুর টিউমার (ফাইব্রয়েড)",
    specialties: ["GYN"],
  },
  {
    code: "E03.9",
    label: "Hypothyroidism, unspecified",
    glossBn: "থাইরয়েড হরমোনের ঘাটতি",
    specialties: ["ENDO", "MED"],
  },
  {
    code: "E04.9",
    label: "Nontoxic goitre, unspecified",
    glossBn: "গলগণ্ড",
    specialties: ["ENDO"],
  },
  {
    code: "E05.9",
    label: "Thyrotoxicosis, unspecified",
    glossBn: "থাইরয়েড হরমোনের আধিক্য",
    specialties: ["ENDO"],
  },
  {
    code: "E10.9",
    label: "Type 1 diabetes mellitus without complications",
    glossBn: "টাইপ ১ ডায়াবেটিস",
    specialties: ["ENDO", "PAED"],
  },
  {
    code: "E11.2",
    label: "Type 2 diabetes mellitus with renal complications",
    glossBn: "কিডনি জটিলতাসহ টাইপ ২ ডায়াবেটিস",
    specialties: ["ENDO", "NEPH"],
  },
  {
    code: "E11.4",
    label: "Type 2 diabetes mellitus with neurological complications",
    glossBn: "স্নায়ু জটিলতাসহ টাইপ ২ ডায়াবেটিস",
    specialties: ["ENDO"],
  },
  {
    code: "E11.9",
    label: "Type 2 diabetes mellitus without complications",
    glossBn: "টাইপ ২ ডায়াবেটিস",
    specialties: ["MED", "ENDO"],
  },
  {
    code: "E16.2",
    label: "Hypoglycaemia, unspecified",
    glossBn: "রক্তে সুগার কমে যাওয়া",
    specialties: ["MED", "ENDO"],
  },
  {
    code: "E28.2",
    label: "Polycystic ovarian syndrome",
    glossBn: "পলিসিস্টিক ওভারি সিনড্রোম",
    specialties: ["GYN", "ENDO"],
  },
  {
    code: "E55.9",
    label: "Vitamin D deficiency, unspecified",
    glossBn: "ভিটামিন ডি-এর ঘাটতি",
    specialties: ["MED", "ORTH"],
  },
  {
    code: "E66.9",
    label: "Obesity, unspecified",
    glossBn: "স্থূলতা",
    specialties: ["MED", "ENDO"],
  },
  {
    code: "E78.5",
    label: "Hyperlipidaemia, unspecified",
    glossBn: "রক্তে চর্বি বেশি",
    specialties: ["MED", "CARD"],
  },
  {
    code: "E86",
    label: "Volume depletion",
    glossBn: "পানিশূন্যতা",
    specialties: ["MED", "PAED"],
  },
  {
    code: "E87.5",
    label: "Hyperkalaemia",
    glossBn: "রক্তে পটাশিয়াম বেশি",
    specialties: ["NEPH", "MED"],
  },

  /* Mental health and neurology */
  {
    code: "F10.2",
    label:
      "Mental and behavioural disorders due to alcohol: dependence syndrome",
    glossBn: "মদ্যপান নির্ভরতা",
    specialties: ["PSY"],
  },
  {
    code: "F20.9",
    label: "Schizophrenia, unspecified",
    glossBn: "সিজোফ্রেনিয়া",
    specialties: ["PSY"],
  },
  {
    code: "F31.9",
    label: "Bipolar affective disorder, unspecified",
    glossBn: "বাইপোলার ডিসঅর্ডার",
    specialties: ["PSY"],
  },
  {
    code: "F32.9",
    label: "Depressive episode, unspecified",
    glossBn: "বিষণ্নতা",
    specialties: ["PSY"],
  },
  {
    code: "F41.0",
    label: "Panic disorder",
    glossBn: "প্যানিক ডিসঅর্ডার",
    specialties: ["PSY"],
  },
  {
    code: "F41.1",
    label: "Generalized anxiety disorder",
    glossBn: "অতিরিক্ত দুশ্চিন্তা",
    specialties: ["PSY"],
  },
  {
    code: "F51.0",
    label: "Nonorganic insomnia",
    glossBn: "অনিদ্রা",
    specialties: ["PSY"],
  },
  {
    code: "F90.0",
    label: "Disturbance of activity and attention",
    glossBn: "মনোযোগ ও অস্থিরতাজনিত সমস্যা",
    specialties: ["PSY", "PAED"],
  },
  {
    code: "G20",
    label: "Parkinson disease",
    glossBn: "পারকিনসন রোগ",
    specialties: ["NEURO"],
  },
  {
    code: "G40.9",
    label: "Epilepsy, unspecified",
    glossBn: "মৃগী",
    specialties: ["NEURO", "PAED"],
  },
  {
    code: "G43.9",
    label: "Migraine, unspecified",
    glossBn: "মাইগ্রেন",
    specialties: ["NEURO", "MED"],
  },
  {
    code: "G44.2",
    label: "Tension-type headache",
    glossBn: "টেনশনজনিত মাথাব্যথা",
    specialties: ["NEURO", "MED"],
  },
  {
    code: "G45.9",
    label: "Transient cerebral ischaemic attack, unspecified",
    glossBn: "ক্ষণস্থায়ী মস্তিষ্কে রক্তসঞ্চালন বিঘ্ন",
    specialties: ["NEURO"],
  },
  {
    code: "G51.0",
    label: "Bell palsy",
    glossBn: "বেলস পালসি (মুখ বেঁকে যাওয়া)",
    specialties: ["NEURO"],
  },
  {
    code: "G56.0",
    label: "Carpal tunnel syndrome",
    glossBn: "কার্পাল টানেল সিনড্রোম",
    specialties: ["NEURO", "ORTH"],
  },
  {
    code: "G62.9",
    label: "Polyneuropathy, unspecified",
    glossBn: "স্নায়ুর দুর্বলতা (নিউরোপ্যাথি)",
    specialties: ["NEURO", "ENDO"],
  },

  /* Eye and ear */
  {
    code: "H00.0",
    label: "Hordeolum and other deep inflammation of eyelid",
    glossBn: "অঞ্জনি",
    specialties: ["OPH"],
  },
  {
    code: "H04.1",
    label: "Other disorders of lacrimal gland (dry eye)",
    glossBn: "চোখ শুষ্ক হওয়া",
    specialties: ["OPH"],
  },
  {
    code: "H10.1",
    label: "Acute atopic conjunctivitis",
    glossBn: "অ্যালার্জিজনিত চোখ ওঠা",
    specialties: ["OPH"],
  },
  {
    code: "H10.9",
    label: "Conjunctivitis, unspecified",
    glossBn: "চোখ ওঠা",
    specialties: ["OPH", "PAED"],
  },
  {
    code: "H25.9",
    label: "Senile cataract, unspecified",
    glossBn: "বয়সজনিত ছানি",
    specialties: ["OPH"],
  },
  {
    code: "H40.9",
    label: "Glaucoma, unspecified",
    glossBn: "গ্লুকোমা",
    specialties: ["OPH"],
  },
  {
    code: "H52.1",
    label: "Myopia",
    glossBn: "দূরের জিনিস ঝাপসা দেখা",
    specialties: ["OPH"],
  },
  {
    code: "H52.4",
    label: "Presbyopia",
    glossBn: "চালশে",
    specialties: ["OPH"],
  },
  {
    code: "H60.9",
    label: "Otitis externa, unspecified",
    glossBn: "বহিঃকর্ণের প্রদাহ",
    specialties: ["ENT"],
  },
  {
    code: "H61.2",
    label: "Impacted cerumen",
    glossBn: "কানে খোল জমা",
    specialties: ["ENT"],
  },
  {
    code: "H65.9",
    label: "Nonsuppurative otitis media, unspecified",
    glossBn: "মধ্যকর্ণে পানি জমা",
    specialties: ["ENT", "PAED"],
  },
  {
    code: "H66.9",
    label: "Otitis media, unspecified",
    glossBn: "মধ্যকর্ণের প্রদাহ",
    specialties: ["ENT", "PAED"],
  },
  {
    code: "H81.1",
    label: "Benign paroxysmal vertigo",
    glossBn: "মাথা ঘোরা (ভার্টিগো)",
    specialties: ["ENT", "NEURO"],
  },
  {
    code: "H91.9",
    label: "Hearing loss, unspecified",
    glossBn: "শ্রবণশক্তি কমে যাওয়া",
    specialties: ["ENT"],
  },

  /* Circulatory */
  {
    code: "I05.0",
    label: "Mitral stenosis",
    glossBn: "মাইট্রাল ভাল্ভ সরু হওয়া",
    specialties: ["CARD"],
  },
  {
    code: "I10",
    label: "Essential (primary) hypertension",
    glossBn: "উচ্চ রক্তচাপ",
    specialties: ["MED", "CARD"],
  },
  {
    code: "I11.9",
    label: "Hypertensive heart disease without heart failure",
    glossBn: "উচ্চ রক্তচাপজনিত হৃদরোগ",
    specialties: ["CARD"],
  },
  {
    code: "I20.9",
    label: "Angina pectoris, unspecified",
    glossBn: "এনজাইনা (বুকে ব্যথা)",
    specialties: ["CARD", "MED"],
  },
  {
    code: "I25.1",
    label: "Atherosclerotic heart disease",
    glossBn: "করোনারি ধমনীর রোগ",
    specialties: ["CARD"],
  },
  {
    code: "I34.0",
    label: "Mitral (valve) insufficiency",
    glossBn: "মাইট্রাল ভাল্ভ লিক",
    specialties: ["CARD"],
  },
  {
    code: "I48.9",
    label: "Atrial fibrillation and atrial flutter, unspecified",
    glossBn: "অনিয়মিত হৃৎস্পন্দন",
    specialties: ["CARD"],
  },
  {
    code: "I49.9",
    label: "Cardiac arrhythmia, unspecified",
    glossBn: "হৃৎস্পন্দনের ছন্দপতন",
    specialties: ["CARD"],
  },
  {
    code: "I50.9",
    label: "Heart failure, unspecified",
    glossBn: "হার্ট ফেইলিউর",
    specialties: ["CARD", "MED"],
  },
  {
    code: "I63.9",
    label: "Cerebral infarction, unspecified",
    glossBn: "স্ট্রোক (রক্তনালী বন্ধ)",
    specialties: ["NEURO"],
  },
  {
    code: "I73.9",
    label: "Peripheral vascular disease, unspecified",
    glossBn: "হাত-পায়ের রক্তনালীর রোগ",
    specialties: ["CARD", "SURG"],
  },
  {
    code: "I83.9",
    label: "Varicose veins of lower extremities",
    glossBn: "পায়ের শিরা ফুলে যাওয়া",
    specialties: ["SURG"],
  },

  /* Respiratory */
  {
    code: "J00",
    label: "Acute nasopharyngitis (common cold)",
    glossBn: "সর্দি-কাশি",
    specialties: ["MED", "PAED", "ENT"],
  },
  {
    code: "J01.9",
    label: "Acute sinusitis, unspecified",
    glossBn: "সাইনাসের প্রদাহ",
    specialties: ["ENT"],
  },
  {
    code: "J02.9",
    label: "Acute pharyngitis, unspecified",
    glossBn: "গলা ব্যথা",
    specialties: ["ENT", "MED", "PAED"],
  },
  {
    code: "J03.9",
    label: "Acute tonsillitis, unspecified",
    glossBn: "টনসিলের প্রদাহ",
    specialties: ["ENT", "PAED"],
  },
  {
    code: "J06.9",
    label: "Acute upper respiratory infection, unspecified",
    glossBn: "শ্বাসনালীর উপরের অংশের সংক্রমণ",
    specialties: ["MED", "PAED"],
  },
  {
    code: "J15.9",
    label: "Bacterial pneumonia, unspecified",
    glossBn: "ব্যাকটেরিয়াজনিত নিউমোনিয়া",
    specialties: ["CHEST", "MED"],
  },
  {
    code: "J18.9",
    label: "Pneumonia, unspecified",
    glossBn: "নিউমোনিয়া",
    specialties: ["CHEST", "MED", "PAED"],
  },
  {
    code: "J20.9",
    label: "Acute bronchitis, unspecified",
    glossBn: "ব্রঙ্কাইটিস",
    specialties: ["MED", "CHEST"],
  },
  {
    code: "J21.9",
    label: "Acute bronchiolitis, unspecified",
    glossBn: "ব্রঙ্কিওলাইটিস",
    specialties: ["PAED"],
  },
  {
    code: "J30.4",
    label: "Allergic rhinitis, unspecified",
    glossBn: "অ্যালার্জিজনিত সর্দি",
    specialties: ["ENT", "MED"],
  },
  {
    code: "J32.9",
    label: "Chronic sinusitis, unspecified",
    glossBn: "দীর্ঘমেয়াদি সাইনুসাইটিস",
    specialties: ["ENT"],
  },
  {
    code: "J34.2",
    label: "Deviated nasal septum",
    glossBn: "নাকের হাড় বাঁকা",
    specialties: ["ENT"],
  },
  {
    code: "J35.0",
    label: "Chronic tonsillitis",
    glossBn: "দীর্ঘমেয়াদি টনসিলাইটিস",
    specialties: ["ENT"],
  },
  {
    code: "J43.9",
    label: "Emphysema, unspecified",
    glossBn: "এমফাইসিমা",
    specialties: ["CHEST"],
  },
  {
    code: "J44.9",
    label: "Chronic obstructive pulmonary disease, unspecified",
    glossBn: "সিওপিডি",
    specialties: ["CHEST", "MED"],
  },
  {
    code: "J45.9",
    label: "Asthma, unspecified",
    glossBn: "হাঁপানি",
    specialties: ["CHEST", "MED", "PAED"],
  },
  {
    code: "J47",
    label: "Bronchiectasis",
    glossBn: "ব্রঙ্কিয়েকটেসিস",
    specialties: ["CHEST"],
  },
  {
    code: "J90",
    label: "Pleural effusion, not elsewhere classified",
    glossBn: "ফুসফুসের আবরণে পানি",
    specialties: ["CHEST"],
  },

  /* Digestive */
  {
    code: "K21.9",
    label: "Gastro-oesophageal reflux disease without oesophagitis",
    glossBn: "বুক জ্বালা (অ্যাসিড রিফ্লাক্স)",
    specialties: ["GASTRO", "MED"],
  },
  {
    code: "K25.9",
    label: "Gastric ulcer, unspecified",
    glossBn: "পাকস্থলীর আলসার",
    specialties: ["GASTRO"],
  },
  {
    code: "K26.9",
    label: "Duodenal ulcer, unspecified",
    glossBn: "ডিওডেনাল আলসার",
    specialties: ["GASTRO"],
  },
  {
    code: "K29.7",
    label: "Gastritis, unspecified",
    glossBn: "গ্যাস্ট্রাইটিস",
    specialties: ["MED", "GASTRO"],
  },
  {
    code: "K30",
    label: "Functional dyspepsia",
    glossBn: "বদহজম",
    specialties: ["MED", "GASTRO"],
  },
  {
    code: "K40.9",
    label: "Unilateral inguinal hernia, without obstruction or gangrene",
    glossBn: "কুঁচকির হার্নিয়া",
    specialties: ["SURG"],
  },
  {
    code: "K42.9",
    label: "Umbilical hernia without obstruction or gangrene",
    glossBn: "নাভির হার্নিয়া",
    specialties: ["SURG"],
  },
  {
    code: "K52.9",
    label: "Noninfective gastroenteritis and colitis, unspecified",
    glossBn: "অসংক্রামক পেটের প্রদাহ",
    specialties: ["GASTRO", "PAED"],
  },
  {
    code: "K58.9",
    label: "Irritable bowel syndrome without diarrhoea",
    glossBn: "আইবিএস",
    specialties: ["GASTRO"],
  },
  {
    code: "K59.0",
    label: "Constipation",
    glossBn: "কোষ্ঠকাঠিন্য",
    specialties: ["MED", "GASTRO", "PAED"],
  },
  {
    code: "K60.2",
    label: "Anal fissure, unspecified",
    glossBn: "এনাল ফিশার",
    specialties: ["SURG"],
  },
  {
    code: "K61.0",
    label: "Anal abscess",
    glossBn: "মলদ্বারে ফোড়া",
    specialties: ["SURG"],
  },
  {
    code: "K64.9",
    label: "Haemorrhoids, unspecified",
    glossBn: "পাইলস",
    specialties: ["SURG"],
  },
  {
    code: "K74.6",
    label: "Other and unspecified cirrhosis of liver",
    glossBn: "লিভার সিরোসিস",
    specialties: ["GASTRO"],
  },
  {
    code: "K76.0",
    label: "Fatty (change of) liver, not elsewhere classified",
    glossBn: "ফ্যাটি লিভার",
    specialties: ["GASTRO", "MED"],
  },
  {
    code: "K80.2",
    label: "Calculus of gallbladder without cholecystitis",
    glossBn: "পিত্তথলির পাথর",
    specialties: ["SURG", "GASTRO"],
  },
  {
    code: "K85.9",
    label: "Acute pancreatitis, unspecified",
    glossBn: "অগ্ন্যাশয়ের প্রদাহ",
    specialties: ["GASTRO"],
  },
  {
    code: "K92.2",
    label: "Gastrointestinal haemorrhage, unspecified",
    glossBn: "পরিপাকতন্ত্রে রক্তক্ষরণ",
    specialties: ["GASTRO"],
  },

  /* Skin */
  {
    code: "L02.9",
    label: "Cutaneous abscess, furuncle and carbuncle, unspecified",
    glossBn: "ফোড়া",
    specialties: ["SURG", "DERM"],
  },
  {
    code: "L20.9",
    label: "Atopic dermatitis, unspecified",
    glossBn: "একজিমা",
    specialties: ["DERM", "PAED"],
  },
  {
    code: "L21.9",
    label: "Seborrhoeic dermatitis, unspecified",
    glossBn: "খুশকিজনিত চর্মপ্রদাহ",
    specialties: ["DERM"],
  },
  {
    code: "L22",
    label: "Diaper (napkin) dermatitis",
    glossBn: "ডায়াপার র‍্যাশ",
    specialties: ["PAED", "DERM"],
  },
  {
    code: "L23.9",
    label: "Allergic contact dermatitis, unspecified cause",
    glossBn: "স্পর্শজনিত চর্ম অ্যালার্জি",
    specialties: ["DERM"],
  },
  {
    code: "L30.9",
    label: "Dermatitis, unspecified",
    glossBn: "চর্মপ্রদাহ",
    specialties: ["DERM"],
  },
  {
    code: "L40.0",
    label: "Psoriasis vulgaris",
    glossBn: "সোরিয়াসিস",
    specialties: ["DERM"],
  },
  {
    code: "L50.9",
    label: "Urticaria, unspecified",
    glossBn: "আমবাত",
    specialties: ["DERM", "MED"],
  },
  {
    code: "L63.9",
    label: "Alopecia areata, unspecified",
    glossBn: "ছোপ ছোপ চুল পড়া",
    specialties: ["DERM"],
  },
  {
    code: "L70.0",
    label: "Acne vulgaris",
    glossBn: "ব্রণ",
    specialties: ["DERM"],
  },
  { code: "L80", label: "Vitiligo", glossBn: "শ্বেতী", specialties: ["DERM"] },

  /* Musculoskeletal */
  {
    code: "M06.9",
    label: "Rheumatoid arthritis, unspecified",
    glossBn: "রিউমাটয়েড আর্থ্রাইটিস",
    specialties: ["MED", "ORTH"],
  },
  {
    code: "M10.9",
    label: "Gout, unspecified",
    glossBn: "গেঁটে বাত",
    specialties: ["MED", "ORTH"],
  },
  {
    code: "M17.9",
    label: "Gonarthrosis, unspecified (knee osteoarthritis)",
    glossBn: "হাঁটুর ক্ষয়জনিত বাত",
    specialties: ["ORTH"],
  },
  {
    code: "M25.5",
    label: "Pain in joint",
    glossBn: "গিঁটে ব্যথা",
    specialties: ["ORTH", "MED"],
  },
  {
    code: "M47.9",
    label: "Spondylosis, unspecified",
    glossBn: "স্পন্ডাইলোসিস",
    specialties: ["ORTH"],
  },
  {
    code: "M51.1",
    label: "Lumbar and other intervertebral disc disorders with radiculopathy",
    glossBn: "ডিস্ক সরে স্নায়ুতে চাপ",
    specialties: ["ORTH", "NEURO"],
  },
  {
    code: "M54.5",
    label: "Low back pain",
    glossBn: "কোমর ব্যথা",
    specialties: ["ORTH", "MED"],
  },
  {
    code: "M65.3",
    label: "Trigger finger",
    glossBn: "ট্রিগার ফিঙ্গার",
    specialties: ["ORTH"],
  },
  {
    code: "M72.2",
    label: "Plantar fascial fibromatosis (plantar fasciitis)",
    glossBn: "গোড়ালি ব্যথা",
    specialties: ["ORTH"],
  },
  {
    code: "M75.0",
    label: "Adhesive capsulitis of shoulder",
    glossBn: "ফ্রোজেন শোল্ডার",
    specialties: ["ORTH"],
  },
  {
    code: "M77.1",
    label: "Lateral epicondylitis",
    glossBn: "টেনিস এলবো",
    specialties: ["ORTH"],
  },
  {
    code: "M79.1",
    label: "Myalgia",
    glossBn: "মাংসপেশিতে ব্যথা",
    specialties: ["MED", "ORTH"],
  },
  {
    code: "M81.0",
    label: "Postmenopausal osteoporosis",
    glossBn: "হাড় ক্ষয় (অস্টিওপোরোসিস)",
    specialties: ["ORTH", "GYN"],
  },

  /* Kidney, urinary and reproductive */
  {
    code: "N04.9",
    label: "Nephrotic syndrome, unspecified",
    glossBn: "নেফ্রোটিক সিনড্রোম",
    specialties: ["NEPH", "PAED"],
  },
  {
    code: "N17.9",
    label: "Acute renal failure, unspecified",
    glossBn: "হঠাৎ কিডনি বিকল",
    specialties: ["NEPH"],
  },
  {
    code: "N18.3",
    label: "Chronic kidney disease, stage 3",
    glossBn: "দীর্ঘমেয়াদি কিডনি রোগ (স্টেজ ৩)",
    specialties: ["NEPH", "MED"],
  },
  {
    code: "N18.4",
    label: "Chronic kidney disease, stage 4",
    glossBn: "দীর্ঘমেয়াদি কিডনি রোগ (স্টেজ ৪)",
    specialties: ["NEPH"],
  },
  {
    code: "N18.5",
    label: "Chronic kidney disease, stage 5",
    glossBn: "দীর্ঘমেয়াদি কিডনি রোগ (স্টেজ ৫)",
    specialties: ["NEPH"],
  },
  {
    code: "N20.0",
    label: "Calculus of kidney",
    glossBn: "কিডনিতে পাথর",
    specialties: ["URO", "NEPH"],
  },
  {
    code: "N23",
    label: "Unspecified renal colic",
    glossBn: "কিডনির ব্যথা",
    specialties: ["URO"],
  },
  {
    code: "N30.0",
    label: "Acute cystitis",
    glossBn: "মূত্রথলির প্রদাহ",
    specialties: ["URO", "GYN"],
  },
  {
    code: "N39.0",
    label: "Urinary tract infection, site not specified",
    glossBn: "প্রস্রাবের সংক্রমণ",
    specialties: ["MED", "URO", "GYN", "PAED"],
  },
  {
    code: "N40",
    label: "Hyperplasia of prostate",
    glossBn: "প্রোস্টেট বড় হওয়া",
    specialties: ["URO"],
  },
  {
    code: "N43.3",
    label: "Hydrocele, unspecified",
    glossBn: "হাইড্রোসিল",
    specialties: ["URO", "SURG"],
  },
  {
    code: "N76.0",
    label: "Acute vaginitis",
    glossBn: "যোনিপথের প্রদাহ",
    specialties: ["GYN"],
  },
  {
    code: "N83.2",
    label: "Other and unspecified ovarian cysts",
    glossBn: "ডিম্বাশয়ে সিস্ট",
    specialties: ["GYN"],
  },
  {
    code: "N92.0",
    label: "Excessive and frequent menstruation with regular cycle",
    glossBn: "অতিরিক্ত মাসিক",
    specialties: ["GYN"],
  },
  {
    code: "N94.6",
    label: "Dysmenorrhoea, unspecified",
    glossBn: "ব্যথাযুক্ত মাসিক",
    specialties: ["GYN"],
  },
  {
    code: "N95.1",
    label: "Menopausal and female climacteric states",
    glossBn: "মেনোপজজনিত সমস্যা",
    specialties: ["GYN"],
  },
  {
    code: "N97.9",
    label: "Female infertility, unspecified",
    glossBn: "নারী বন্ধ্যাত্ব",
    specialties: ["GYN"],
  },

  /* Pregnancy */
  {
    code: "O13",
    label: "Gestational hypertension",
    glossBn: "গর্ভকালীন উচ্চ রক্তচাপ",
    specialties: ["GYN"],
  },
  {
    code: "O20.0",
    label: "Threatened abortion",
    glossBn: "গর্ভপাতের আশঙ্কা",
    specialties: ["GYN"],
  },
  {
    code: "O21.0",
    label: "Mild hyperemesis gravidarum",
    glossBn: "গর্ভকালীন অতিরিক্ত বমি",
    specialties: ["GYN"],
  },
  {
    code: "O24.4",
    label: "Diabetes mellitus arising in pregnancy",
    glossBn: "গর্ভকালীন ডায়াবেটিস",
    specialties: ["GYN", "ENDO"],
  },

  /* Symptoms and signs */
  {
    code: "R05",
    label: "Cough",
    glossBn: "কাশি",
    specialties: ["MED", "PAED", "CHEST"],
  },
  {
    code: "R06.0",
    label: "Dyspnoea",
    glossBn: "শ্বাসকষ্ট",
    specialties: ["MED", "CARD", "CHEST"],
  },
  {
    code: "R07.4",
    label: "Chest pain, unspecified",
    glossBn: "বুকে ব্যথা",
    specialties: ["MED", "CARD"],
  },
  {
    code: "R10.4",
    label: "Other and unspecified abdominal pain",
    glossBn: "পেটে ব্যথা",
    specialties: ["MED", "GASTRO", "SURG"],
  },
  {
    code: "R11",
    label: "Nausea and vomiting",
    glossBn: "বমি বমি ভাব ও বমি",
    specialties: ["MED", "PAED"],
  },
  {
    code: "R31",
    label: "Unspecified haematuria",
    glossBn: "প্রস্রাবে রক্ত",
    specialties: ["URO", "NEPH"],
  },
  {
    code: "R42",
    label: "Dizziness and giddiness",
    glossBn: "মাথা ঘোরা",
    specialties: ["MED", "NEURO", "ENT"],
  },
  {
    code: "R50.9",
    label: "Fever, unspecified",
    glossBn: "জ্বর",
    specialties: ["MED", "PAED"],
  },
  {
    code: "R51",
    label: "Headache",
    glossBn: "মাথাব্যথা",
    specialties: ["MED", "NEURO"],
  },
  {
    code: "R53",
    label: "Malaise and fatigue",
    glossBn: "দুর্বলতা ও ক্লান্তি",
    specialties: ["MED"],
  },
  {
    code: "R56.0",
    label: "Febrile convulsions",
    glossBn: "জ্বরজনিত খিঁচুনি",
    specialties: ["PAED"],
  },
  {
    code: "R04.0",
    label: "Epistaxis",
    glossBn: "নাক দিয়ে রক্ত পড়া",
    specialties: ["ENT"],
  },
  {
    code: "R20.2",
    label: "Paraesthesia of skin",
    glossBn: "ঝিনঝিন বা অবশ ভাব",
    specialties: ["NEURO"],
  },

  /* Injuries */
  {
    code: "S93.4",
    label: "Sprain and strain of ankle",
    glossBn: "গোড়ালি মচকানো",
    specialties: ["ORTH"],
  },
  {
    code: "S62.6",
    label: "Fracture of other finger",
    glossBn: "আঙুলের হাড় ভাঙা",
    specialties: ["ORTH"],
  },
  {
    code: "T14.0",
    label: "Superficial injury of unspecified body region",
    glossBn: "হালকা আঘাত",
    specialties: ["SURG", "ORTH"],
  },
  {
    code: "T78.4",
    label: "Allergy, unspecified",
    glossBn: "অ্যালার্জি",
    specialties: ["MED", "DERM"],
  },

  /* Health services */
  {
    code: "Z00.0",
    label: "General medical examination",
    glossBn: "সাধারণ স্বাস্থ্য পরীক্ষা",
    specialties: ["MED"],
  },
  {
    code: "Z01.4",
    label: "Gynaecological examination (general) (routine)",
    glossBn: "স্ত্রীরোগ বিষয়ক রুটিন পরীক্ষা",
    specialties: ["GYN"],
  },
  {
    code: "Z09",
    label: "Follow-up examination after treatment",
    glossBn: "চিকিৎসা পরবর্তী ফলো-আপ",
    specialties: ["MED"],
  },
  {
    code: "Z13.1",
    label: "Special screening examination for diabetes mellitus",
    glossBn: "ডায়াবেটিস স্ক্রিনিং",
    specialties: ["MED", "ENDO"],
  },
  {
    code: "Z34.9",
    label: "Supervision of normal pregnancy, unspecified",
    glossBn: "স্বাভাবিক গর্ভাবস্থার চেক-আপ",
    specialties: ["GYN"],
  },
  {
    code: "Z71.3",
    label: "Dietary counselling and surveillance",
    glossBn: "খাদ্যাভ্যাস বিষয়ক পরামর্শ",
    specialties: ["MED", "ENDO"],
  },
  {
    code: "Z76.0",
    label: "Issue of repeat prescription",
    glossBn: "পুরনো প্রেসক্রিপশন নবায়ন",
    specialties: ["MED"],
  },
]

export function findIcd10(code: string): Icd10Entry | undefined {
  return ICD10.find((e) => e.code === code)
}
