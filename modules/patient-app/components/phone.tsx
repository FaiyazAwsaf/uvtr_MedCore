"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Dialog } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Overlays that belong INSIDE the phone (SMS and push banners, bottom
 * sheets). They portal into the shell's phone frame (`data-slot="phone-frame"`,
 * positioned and clipped) instead of the page body, so a banner drops from the
 * top of the phone and a sheet rises from its bottom edge, never over the demo
 * controls beside it. Without a frame (a phone-sized window) the frame element
 * is the whole window, which works the same way.
 */

const PhoneContext = React.createContext<HTMLElement | null>(null)

export function PhoneRoot({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [frame, setFrame] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => {
    setFrame(
      ref.current?.closest<HTMLElement>('[data-slot="phone-frame"]') ??
        document.body
    )
  }, [])
  return (
    <PhoneContext.Provider value={frame}>
      <div ref={ref} data-slot="patient-app-root" className={className}>
        {children}
      </div>
    </PhoneContext.Provider>
  )
}

export function usePhoneFrame(): HTMLElement | null {
  return React.useContext(PhoneContext)
}

/** Renders children on top of the phone screen (absolute, inside the frame). */
export function PhoneOverlay({ children }: { children: React.ReactNode }) {
  const frame = usePhoneFrame()
  return frame ? createPortal(children, frame) : null
}

/**
 * A notification-style banner at the top of the phone, like an incoming SMS or
 * push alert. Tapping it runs `onOpen`; it hides itself after `durationMs`.
 */
export function PhoneBanner({
  open,
  onClose,
  onOpen,
  icon,
  title,
  meta,
  children,
  durationMs = 8000,
  testId,
  label,
}: {
  open: boolean
  onClose: () => void
  onOpen?: () => void
  icon: React.ReactNode
  title: React.ReactNode
  meta?: React.ReactNode
  children: React.ReactNode
  durationMs?: number
  testId?: string
  /** Accessible name when the banner is a button */
  label?: string
}) {
  React.useEffect(() => {
    if (!open || !durationMs) return
    const timer = window.setTimeout(onClose, durationMs)
    return () => window.clearTimeout(timer)
  }, [open, durationMs, onClose])

  if (!open) return null
  const body = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[0.8rem]">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="truncate text-[0.8125rem] font-semibold">
            {title}
          </span>
          {meta ? (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {meta}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[0.8125rem] leading-snug">
          {children}
        </span>
      </span>
    </>
  )
  const surface =
    "animate-in fade-in slide-in-from-top-4 duration-300 flex w-full items-start gap-3 rounded-[1.4rem] border border-hairline bg-popover/95 p-3 text-popover-foreground shadow-[0_18px_40px_-12px_rgb(0_0_0/0.45)] backdrop-blur"
  return (
    <PhoneOverlay>
      <div
        role="status"
        aria-live="polite"
        data-testid={testId}
        className="absolute inset-x-2.5 top-2.5 z-50 min-[30rem]:top-12"
      >
        {onOpen ? (
          <button
            type="button"
            aria-label={label}
            onClick={() => {
              onOpen()
              onClose()
            }}
            className={cn(
              surface,
              "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            )}
          >
            {body}
          </button>
        ) : (
          <div className={surface}>{body}</div>
        )}
      </div>
    </PhoneOverlay>
  )
}

/** A bottom sheet inside the phone (Base UI dialog portalled into the frame). */
export function PhoneSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  testId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  testId?: string
}) {
  const frame = usePhoneFrame()
  const { t } = useLocale()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={frame}>
        <Dialog.Backdrop className="absolute inset-0 z-40 bg-black/45 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          data-testid={testId}
          className="absolute inset-x-0 bottom-0 z-50 flex max-h-[88%] flex-col rounded-t-[1.75rem] bg-popover text-popover-foreground shadow-2xl transition duration-200 ease-out outline-none data-ending-style:translate-y-10 data-ending-style:opacity-0 data-starting-style:translate-y-10 data-starting-style:opacity-0"
        >
          <span
            aria-hidden
            className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-foreground/20"
          />
          <div className="flex items-start gap-3 px-5 pt-3 pb-2">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[1.0625rem] leading-snug font-semibold">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label={t("common.close")}
              className="-mt-1 -mr-2 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-surface-raised hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <XIcon className="size-5" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-8">
            {children}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
