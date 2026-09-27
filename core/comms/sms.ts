import { rules } from "@/config/rules.config"
import type { Id, NotificationRow, Refs, SmsRow } from "@/core/db/schema"
import type { Tx } from "@/core/engine/types"
import type { Locale } from "@/lib/i18n/config"
import { renderSms, type SmsTemplateId } from "@/modules/comms/templates"

/** GSM-7 basic characters (approximation); anything else forces UCS-2. */
const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅå_ÆæßÉ!"#%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/

/** Parts and encoding of an SMS (PRD §10.19: Bangla uses UCS-2, 70/67 characters). */
export function smsParts(text: string): { parts: number; encoding: "GSM" | "UCS-2" } {
  const gsm = GSM.test(text)
  const limits = gsm ? rules.smsParts.en : rules.smsParts.bn
  const length = [...text].length
  const parts = length <= limits.single ? 1 : Math.ceil(length / limits.multi)
  return { parts, encoding: gsm ? "GSM" : "UCS-2" }
}

/**
 * Queue a simulated SMS inside a command. While the branch is offline the
 * message is held and only released when central confirms (PRD §16).
 */
export function queueSms(
  tx: Tx,
  opts: {
    to: string
    patientId?: Id
    lang: Locale
    templateId: SmsTemplateId
    params?: Record<string, string | number>
    kind?: SmsRow["kind"]
  }
): SmsRow {
  const text = renderSms(opts.templateId, opts.lang, opts.params ?? {})
  const { parts, encoding } = smsParts(text)
  return tx.insert("sms", {
    to: opts.to,
    patientId: opts.patientId,
    branchId: tx.actor.branchId ?? undefined,
    lang: opts.lang,
    templateId: opts.templateId,
    text,
    parts,
    encoding,
    kind: opts.kind ?? "transactional",
    status: tx.isEdge ? "held-offline" : "queued",
    queuedAt: tx.now(),
  })
}

/**
 * Patient-app notification. The push text is always generic ("You have a new
 * notification"); `titleKey` is shown only inside the app after login.
 */
export function notifyPatient(
  tx: Tx,
  opts: {
    patientId: Id
    kind: string
    titleKey: string
    params?: Record<string, string | number>
    refs?: Refs
  }
): NotificationRow {
  return tx.insert("notifications", {
    patientId: opts.patientId,
    kind: opts.kind,
    titleKey: opts.titleKey,
    params: opts.params,
    refs: opts.refs ?? {},
    read: false,
    at: tx.now(),
    held: tx.isEdge ? true : undefined,
  })
}
