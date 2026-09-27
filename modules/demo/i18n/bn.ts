import type { demoEn } from "./en"

export const demoBn: typeof demoEn = {
  demo: {
    title: "ডেমো নিয়ন্ত্রণ",
    events: {
      ruleViolationBlocked: "আটকানো হয়েছে: {code}",
      demoReset: "ডেমো ডেটা রিসেট হয়েছে",
      clockAdvanced: "ডেমো ঘড়ি {minutes} মিনিট এগোনো হয়েছে",
      clockReset: "ডেমো ঘড়ি আবার আসল সময়ে",
      branchWentOffline: "শাখা {branch} অফলাইন হয়েছে",
      branchReconnected: "শাখা {branch} আবার সংযুক্ত হয়েছে",
      edgeEventsReplayed: "{branch} থেকে {count}টি অফলাইন ইভেন্ট মিলানো হয়েছে",
      identityConflictQueued: "সম্ভাব্য ডুপ্লিকেট পর্যালোচনায় পাঠানো হয়েছে",
      patientContactUpdated: "যোগাযোগের তথ্য হালনাগাদ হয়েছে",
    },
    consumers: {
      audit: "অডিট",
      allWindows: "সব উইন্ডো",
      timers: "টাইমার",
      allBranches: "সব শাখা",
      dashboard: "ড্যাশবোর্ড",
      central: "কেন্দ্রীয়",
      dataSteward: "ডেটা স্টুয়ার্ড",
      registry: "রোগী নিবন্ধন",
    },
  },
}
