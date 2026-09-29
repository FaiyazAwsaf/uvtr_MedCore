import { hospital } from "@/config/brand.config"
import type { Locale } from "@/lib/i18n/config"

/**
 * SMS templates (PRD §10.19). Messages never contain results, diagnoses or
 * medicine names; they only say something is ready or changed and point to
 * the hospital app or helpline. Params are filled with {name} placeholders.
 */
export const SMS_TEMPLATES = {
  "appointment-booked": {
    en: "{hospital}: Appointment booked with {doctor} on {date} at {time}. Token at check-in. Help: {helpline}",
    bn: "{hospital}: {doctor}-এর সাথে {date} তারিখ {time}-এ অ্যাপয়েন্টমেন্ট নিশ্চিত। চেক-ইনে টোকেন পাবেন। সহায়তা: {helpline}",
  },
  "payment-received": {
    en: "{hospital}: Payment of {amount} received. Receipt {receiptNo}. Thank you.",
    bn: "{hospital}: {amount} পেমেন্ট গ্রহণ করা হয়েছে। রসিদ {receiptNo}। ধন্যবাদ।",
  },
  "report-ready": {
    en: "{hospital}: Your report is ready. View it in the {hospital} app or collect it from the counter.",
    bn: "{hospital}: আপনার রিপোর্ট প্রস্তুত। {hospital} অ্যাপে দেখুন অথবা কাউন্টার থেকে সংগ্রহ করুন।",
  },
  "report-updated": {
    en: "{hospital}: An updated version of your report is available in the {hospital} app.",
    bn: "{hospital}: আপনার রিপোর্টের হালনাগাদ সংস্করণ {hospital} অ্যাপে পাওয়া যাচ্ছে।",
  },
  "sample-recollection": {
    en: "{hospital}: Please visit the lab again for a new sample, free of charge. Sorry for the trouble. Help: {helpline}",
    bn: "{hospital}: বিনামূল্যে নতুন নমুনা দিতে অনুগ্রহ করে আবার ল্যাবে আসুন। অসুবিধার জন্য দুঃখিত। সহায়তা: {helpline}",
  },
  // Doctor delay (S11): the doctor and the minutes only, never the reason.
  "doctor-delay": {
    en: "{hospital}: {doctor} is running about {minutes} minutes late today. Open the app or call {helpline} to wait, rebook or get a refund.",
    bn: "{hospital}: আজ {doctor} প্রায় {minutes} মিনিট দেরিতে আছেন। অপেক্ষা, নতুন সময় বা টাকা ফেরতের জন্য অ্যাপ খুলুন অথবা {helpline} নম্বরে ফোন করুন।",
  },
  // Refund (S9, S10): the amount and the credit note only, never the service.
  "refund-issued": {
    en: "{hospital}: A refund of {amount} has been issued. Credit note {creditNoteNo}. Thank you.",
    bn: "{hospital}: {amount} ফেরত দেওয়া হয়েছে। ক্রেডিট নোট {creditNoteNo}। ধন্যবাদ।",
  },
  "follow-up-reminder": {
    en: "{hospital}: Reminder of your follow-up visit on {date}. Book in the app or call {helpline}.",
    bn: "{hospital}: {date} তারিখে আপনার ফলো-আপ ভিজিটের কথা মনে করিয়ে দিচ্ছি। অ্যাপে বুক করুন অথবা {helpline} নম্বরে ফোন করুন।",
  },
  "medicine-ready": {
    en: "{hospital}: The rest of your medicines is ready to collect at {branch} pharmacy.",
    bn: "{hospital}: আপনার বাকি ওষুধ {branch} ফার্মেসিতে সংগ্রহের জন্য প্রস্তুত।",
  },
  otp: {
    en: "{hospital}: Your verification code is {code}. Do not share it.",
    bn: "{hospital}: আপনার যাচাই কোড {code}। কাউকে জানাবেন না।",
  },
} satisfies Record<string, Record<Locale, string>>

export type SmsTemplateId = keyof typeof SMS_TEMPLATES

export function renderSms(
  templateId: SmsTemplateId,
  lang: Locale,
  params: Record<string, string | number>
): string {
  const values: Record<string, string | number> = {
    hospital: hospital.shortName[lang],
    helpline: hospital.helpline,
    ...params,
  }
  return SMS_TEMPLATES[templateId][lang].replace(
    /\{(\w+)\}/g,
    (match, name: string) => (name in values ? String(values[name]) : match)
  )
}
