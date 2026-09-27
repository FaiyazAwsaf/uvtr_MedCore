/**
 * Curated Bangladeshi name parts in English and Bangla script, used to build
 * synthetic patients. Combinations are random; no entry describes a real
 * person. Names used by the hero household, the scenario patients and the
 * planted duplicates (Rafiqul, Jahanara, Shahidul, Nasima, Kamrul, Tanvir,
 * Nusrat, Rokeya, Shafiqul, Rahima, Sharmin, Parul, the Karim surname and so
 * on) are left out so searches for them stay unambiguous.
 */

/** [English, Bangla] */
export type NamePart = readonly [string, string]

/**
 * Male given names of the older generation. `ur` names pair with "Rahman",
 * `ul` names with Islam, Haque, Alam and similar; `free` names take any
 * family surname.
 */
export const MALE_GIVEN_OLDER: readonly (readonly [
  string,
  string,
  "ur" | "ul" | "free",
])[] = [
  ["Abdul Mannan", "আব্দুল মান্নান", "free"],
  ["Abul Hossain", "আবুল হোসেন", "free"],
  ["Abdul Jalil", "আব্দুল জলিল", "free"],
  ["Abdur Rashid", "আব্দুর রশিদ", "free"],
  ["Abdus Sobhan", "আব্দুস সোবহান", "free"],
  ["Golam Mostafa", "গোলাম মোস্তফা", "free"],
  ["Ruhul Amin", "রুহুল আমিন", "free"],
  ["Jahangir", "জাহাঙ্গীর", "free"],
  ["Alamgir", "আলমগীর", "free"],
  ["Delwar", "দেলোয়ার", "free"],
  ["Faruk", "ফারুক", "free"],
  ["Jamal", "জামাল", "free"],
  ["Belal", "বেলাল", "free"],
  ["Helal", "হেলাল", "free"],
  ["Mosharraf", "মোশাররফ", "free"],
  ["Habibullah", "হাবিবুল্লাহ", "free"],
  ["Anwar", "আনোয়ার", "free"],
  ["Nasir", "নাসির", "free"],
  ["Shafiq", "শফিক", "free"],
  ["Monir", "মনির", "free"],
  ["Aminul", "আমিনুল", "ul"],
  ["Nurul", "নুরুল", "ul"],
  ["Nazrul", "নজরুল", "ul"],
  ["Emdadul", "এমদাদুল", "ul"],
  ["Ashraful", "আশরাফুল", "ul"],
  ["Tariqul", "তরিকুল", "ul"],
  ["Rezaul", "রেজাউল", "ul"],
  ["Azizul", "আজিজুল", "ul"],
  ["Shamsul", "শামসুল", "ul"],
  ["Zahirul", "জহিরুল", "ul"],
  ["Khairul", "খায়রুল", "ul"],
  ["Obaidul", "ওবায়দুল", "ul"],
  ["Enamul", "এনামুল", "ul"],
  ["Monirul", "মনিরুল", "ul"],
  ["Anisur", "আনিসুর", "ur"],
  ["Mahbubur", "মাহবুবুর", "ur"],
  ["Mostafizur", "মোস্তাফিজুর", "ur"],
  ["Saidur", "সাইদুর", "ur"],
  ["Motiur", "মতিউর", "ur"],
  ["Lutfor", "লুৎফর", "ur"],
  ["Siddiqur", "সিদ্দিকুর", "ur"],
  ["Harunur", "হারুনুর", "ur"],
  ["Ataur", "আতাউর", "ur"],
]

/** Male given names of the younger generation (born after about 1990). */
export const MALE_GIVEN_YOUNGER: readonly NamePart[] = [
  ["Sakib", "সাকিব"],
  ["Rifat", "রিফাত"],
  ["Nafis", "নাফিস"],
  ["Tahmid", "তাহমিদ"],
  ["Farhan", "ফারহান"],
  ["Zarif", "জারিফ"],
  ["Ayaan", "আয়ান"],
  ["Arian", "আরিয়ান"],
  ["Rafid", "রাফিদ"],
  ["Shahriar", "শাহরিয়ার"],
  ["Imtiaz", "ইমতিয়াজ"],
  ["Fahim", "ফাহিম"],
  ["Mahir", "মাহির"],
  ["Rayhan", "রায়হান"],
  ["Sabbir", "সাব্বির"],
  ["Nayeem", "নাঈম"],
  ["Towhid", "তৌহিদ"],
  ["Asif", "আসিফ"],
  ["Rakib", "রাকিব"],
  ["Shuvo", "শুভ"],
  ["Tamim", "তামিম"],
  ["Ahnaf", "আহনাফ"],
  ["Wasif", "ওয়াসিফ"],
  ["Ishtiaq", "ইশতিয়াক"],
  ["Adnan", "আদনান"],
  ["Siam", "সিয়াম"],
  ["Tasin", "তাসিন"],
  ["Yasir", "ইয়াসির"],
  ["Mahin", "মাহিন"],
  ["Rashed", "রাশেদ"],
]

/** Family surnames that follow `free` given names. */
export const MALE_SURNAMES: readonly NamePart[] = [
  ["Hossain", "হোসেন"],
  ["Ahmed", "আহমেদ"],
  ["Uddin", "উদ্দিন"],
  ["Mia", "মিয়া"],
  ["Sarkar", "সরকার"],
  ["Chowdhury", "চৌধুরী"],
  ["Talukder", "তালুকদার"],
  ["Bhuiyan", "ভূঁইয়া"],
  ["Khan", "খান"],
  ["Sheikh", "শেখ"],
  ["Molla", "মোল্লা"],
  ["Howlader", "হাওলাদার"],
  ["Mridha", "মৃধা"],
  ["Patwary", "পাটোয়ারী"],
  ["Majumder", "মজুমদার"],
  ["Kabir", "কবির"],
  ["Hasan", "হাসান"],
  ["Mahmud", "মাহমুদ"],
  ["Siddique", "সিদ্দিকী"],
  ["Akand", "আকন্দ"],
  ["Munshi", "মুন্সী"],
]

/** Surnames that follow `ul` given names (Shafiqul Islam, Aminul Haque). */
export const UL_SURNAMES: readonly NamePart[] = [
  ["Islam", "ইসলাম"],
  ["Haque", "হক"],
  ["Alam", "আলম"],
  ["Hasan", "হাসান"],
  ["Kabir", "কবির"],
  ["Huda", "হুদা"],
  ["Amin", "আমিন"],
]

export const UR_SURNAME: NamePart = ["Rahman", "রহমান"]

/** Honorific prefix common on older men's registered names. */
export const MD_PREFIX: NamePart = ["Md.", "মো."]
/** Honorific prefix common on older women's registered names. */
export const MST_PREFIX: NamePart = ["Mst.", "মোছা."]

export const FEMALE_GIVEN_OLDER: readonly NamePart[] = [
  ["Rahela", "রাহেলা"],
  ["Fatema", "ফাতেমা"],
  ["Ayesha", "আয়েশা"],
  ["Salma", "সালমা"],
  ["Shahana", "শাহানা"],
  ["Rabeya", "রাবেয়া"],
  ["Morium", "মরিয়ম"],
  ["Hosne Ara", "হোসনে আরা"],
  ["Parvin", "পারভীন"],
  ["Rehana", "রেহানা"],
  ["Josna", "জোছনা"],
  ["Kulsum", "কুলসুম"],
  ["Rashida", "রাশিদা"],
  ["Mahmuda", "মাহমুদা"],
  ["Nazma", "নাজমা"],
  ["Shamima", "শামীমা"],
  ["Sufia", "সুফিয়া"],
  ["Halima", "হালিমা"],
  ["Amena", "আমেনা"],
  ["Khadija", "খাদিজা"],
  ["Dilruba", "দিলরুবা"],
  ["Kohinoor", "কোহিনূর"],
  ["Afroza", "আফরোজা"],
  ["Monowara", "মনোয়ারা"],
  ["Anowara", "আনোয়ারা"],
  ["Firoza", "ফিরোজা"],
  ["Laila", "লাইলা"],
  ["Selina", "সেলিনা"],
  ["Momtaz", "মমতাজ"],
  ["Rawshan Ara", "রওশন আরা"],
  ["Jesmin", "জেসমিন"],
  ["Tahmina", "তাহমিনা"],
  ["Sabina", "সাবিনা"],
  ["Farida", "ফরিদা"],
  ["Nilufar", "নিলুফার"],
]

export const FEMALE_GIVEN_YOUNGER: readonly NamePart[] = [
  ["Tasnim", "তাসনিম"],
  ["Raisa", "রাইসা"],
  ["Fariha", "ফারিহা"],
  ["Samia", "সামিয়া"],
  ["Mehjabin", "মেহজাবিন"],
  ["Ishrat", "ইশরাত"],
  ["Lamia", "লামিয়া"],
  ["Sumaiya", "সুমাইয়া"],
  ["Tania", "তানিয়া"],
  ["Mitu", "মিতু"],
  ["Rupa", "রূপা"],
  ["Lipi", "লিপি"],
  ["Tamanna", "তামান্না"],
  ["Jannat", "জান্নাত"],
  ["Sadia", "সাদিয়া"],
  ["Nabila", "নাবিলা"],
  ["Afsana", "আফসানা"],
  ["Shanta", "শান্তা"],
  ["Mim", "মীম"],
  ["Zara", "জারা"],
  ["Maliha", "মালিহা"],
  ["Nowshin", "নওশিন"],
  ["Tahsin", "তাহসিন"],
  ["Ritu", "ঋতু"],
  ["Farzana", "ফারজানা"],
  ["Moushumi", "মৌসুমী"],
  ["Anika", "আনিকা"],
  ["Sharmila", "শর্মিলা"],
]

/** Women's surnames of the older generation (Begum, Khatun, Akter). */
export const FEMALE_SURNAMES_OLDER: readonly NamePart[] = [
  ["Begum", "বেগম"],
  ["Begum", "বেগম"],
  ["Khatun", "খাতুন"],
  ["Akter", "আক্তার"],
  ["Sultana", "সুলতানা"],
  ["Nahar", "নাহার"],
]

export const FEMALE_SURNAMES_YOUNGER: readonly NamePart[] = [
  ["Akter", "আক্তার"],
  ["Sultana", "সুলতানা"],
  ["Jahan", "জাহান"],
  ["Islam", "ইসলাম"],
  ["Rahman", "রহমান"],
  ["Haque", "হক"],
  ["Yasmin", "ইয়াসমিন"],
  ["Nahar", "নাহার"],
]

/* ---------------- Hindu families (about 1 household in 15) ---------------- */

export const HINDU_SURNAMES: readonly NamePart[] = [
  ["Das", "দাস"],
  ["Saha", "সাহা"],
  ["Roy", "রায়"],
  ["Dey", "দে"],
  ["Ghosh", "ঘোষ"],
  ["Paul", "পাল"],
  ["Biswas", "বিশ্বাস"],
  ["Mondal", "মণ্ডল"],
  ["Chakraborty", "চক্রবর্তী"],
]

export const HINDU_MALE_GIVEN: readonly NamePart[] = [
  ["Pradip", "প্রদীপ"],
  ["Subrata", "সুব্রত"],
  ["Anup", "অনুপ"],
  ["Tapan", "তপন"],
  ["Gopal", "গোপাল"],
  ["Swapan", "স্বপন"],
  ["Uttam", "উত্তম"],
  ["Sanjoy", "সঞ্জয়"],
  ["Bijoy", "বিজয়"],
  ["Arnab", "অর্ণব"],
  ["Sourav", "সৌরভ"],
  ["Joy", "জয়"],
]

export const HINDU_FEMALE_GIVEN: readonly NamePart[] = [
  ["Rina", "রিনা"],
  ["Shipra", "শিপ্রা"],
  ["Anita", "অনিতা"],
  ["Mala", "মালা"],
  ["Puja", "পূজা"],
  ["Sathi", "সাথী"],
  ["Bithi", "বীথি"],
  ["Mitali", "মিতালী"],
  ["Sumita", "সুমিতা"],
  ["Arpita", "অর্পিতা"],
  ["Moumita", "মৌমিতা"],
  ["Priyanka", "প্রিয়াঙ্কা"],
]

/** Middle part used by older Hindu women: "Anita Rani Das". */
export const RANI: NamePart = ["Rani", "রানী"]

/* ---------------- Addresses ---------------- */

export const DHAKA_AREAS: readonly string[] = [
  "Dhanmondi",
  "Mohammadpur",
  "Lalmatia",
  "Kalabagan",
  "Jigatola",
  "Hazaribagh",
  "Shyamoli",
  "Agargaon",
  "Farmgate",
  "Tejgaon",
  "Uttara Sector 4",
  "Uttara Sector 7",
  "Uttara Sector 11",
  "Uttara Sector 13",
  "Mirpur 1",
  "Mirpur 2",
  "Mirpur 10",
  "Mirpur 11",
  "Pallabi",
  "Kafrul",
  "Motijheel",
  "Paltan",
  "Shantinagar",
  "Malibagh",
  "Khilgaon",
  "Basabo",
  "Jatrabari",
  "Wari",
  "Lalbagh",
  "Badda",
  "Rampura",
  "Banasree",
  "Mohakhali",
  "Keraniganj",
  "Savar",
  "Tongi",
]

export const CHATTOGRAM_AREAS: readonly string[] = [
  "Agrabad",
  "Nasirabad",
  "Panchlaish",
  "Khulshi",
  "Halishahar",
  "Chawkbazar",
  "GEC Circle",
  "Bahaddarhat",
  "Patenga",
  "Kotwali",
  "Muradpur",
  "Oxygen",
]
