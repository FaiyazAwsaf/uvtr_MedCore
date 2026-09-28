import type { imagingEn } from "./en"

export const imagingBn: typeof imagingEn = {
  imaging: {
    title: "ইমেজিং",
    nav: {
      reports: "ইমেজিং রিপোর্ট",
    },
    worklist: {
      title: "ইমেজিং রিপোর্ট",
      subtitle:
        "{branch}-এ পরিশোধিত পরীক্ষা: পরীক্ষা সম্পন্ন চিহ্নিত করুন, রেডিওলজিস্টের স্বাক্ষরিত PDF আপলোড করুন, তারপর প্রকাশ করুন।",
      listTitle: "পরীক্ষাসমূহ",
      empty: "পরিশোধিত কোনো ইমেজিং পরীক্ষা নেই।",
      study: "পরীক্ষা",
      indication: "কারণ",
      markDone: "সম্পন্ন চিহ্নিত করুন",
      upload: "স্বাক্ষরিত রিপোর্ট PDF আপলোড",
      release: "প্রকাশ করুন",
      doneToast: "{study} সম্পন্ন চিহ্নিত হয়েছে",
      uploadedToast: "{orderNo}-এর স্বাক্ষরিত রিপোর্ট আপলোড হয়েছে",
      releasedToast: "{orderNo}-এর ইমেজিং রিপোর্ট প্রকাশিত হয়েছে",
      releasedAt: "প্রকাশ {time}",
      hash: "SHA-256 হ্যাশ {hash}",
    },
    status: {
      ordered: "পেমেন্ট বাকি",
      paid: "অপেক্ষমাণ",
      done: "সম্পন্ন, রিপোর্ট বাকি",
      reported: "রিপোর্ট আপলোড হয়েছে",
      released: "প্রকাশিত",
      cancelled: "বাতিল",
    },
    modalities: {
      xray: "এক্স-রে",
      usg: "আল্ট্রাসাউন্ড",
      ct: "সিটি স্ক্যান",
      mri: "এমআরআই",
      ecg: "ইসিজি",
      echo: "ইকো",
    },
    upload: {
      title: "স্বাক্ষরিত রিপোর্ট PDF আপলোড",
      file: "ফাইল",
      choose: "ফাইল বেছে নিন",
      fileHint:
        "সিমুলেটেড: কোনো ফাইল এই ব্রাউজারের বাইরে যায় না। আমরা শুধু নাম ও SHA-256 হ্যাশ রাখি।",
      radiologist: "রিপোর্টকারী চিকিৎসক",
      summary: "মতামত (ঐচ্ছিক)",
      summaryPlaceholder: "চিকিৎসকের জন্য এক লাইন, যেমন: ফ্যাটি লিভার, গ্রেড ১",
      confirm: "আপলোড",
    },
    events: {
      ImagingStudyCompleted: "ইমেজিং পরীক্ষা {study} সম্পন্ন ({orderNo})",
      ImagingReportUploaded: "ইমেজিং রিপোর্ট আপলোড হয়েছে ({orderNo})",
      ImagingReportReleased: "ইমেজিং রিপোর্ট প্রকাশিত ({orderNo})",
    },
    consumers: {
      radiologist: "রেডিওলজিস্ট",
    },
  },
}
