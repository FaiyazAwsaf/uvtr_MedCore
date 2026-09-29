import type { financeEn } from "./en"

export const financeBn: typeof financeEn = {
  finance: {
    title: "অর্থ",
    nav: {
      cash: "নগদ নিয়ন্ত্রণ",
      mfs: "এমএফএস নিষ্পত্তি",
      match: "ত্রিমুখী মিলান",
      payables: "প্রদেয়",
      feeShare: "ফি শেয়ার",
      corporate: "কর্পোরেট বিল",
      export: "হিসাব রপ্তানি",
      approvals: "অনুমোদন",
    },
    events: {
      threeWayMatched: "{vendorInvoiceNo} {poNo} ও তার মাল গ্রহণের সাথে মিলেছে",
      threeWayMismatch: "{vendorInvoiceNo} {poNo}-এর সাথে মেলেনি: অর্থ বিভাগের কাজের তালিকায় পাঠানো হয়েছে",
      payableCreated: "{vendor}-কে প্রদেয়: {amountBn}, পরিশোধের তারিখ {dueDateBn}",
    },
    consumers: {
      payables: "প্রদেয়",
      worklist: "অর্থ বিভাগের কাজের তালিকা",
      dashboard: "ড্যাশবোর্ড",
    },
  },
}
