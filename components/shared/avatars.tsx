"use client"

import * as React from "react"

import { now } from "@/core/clock/clock"
import { ageOn, dhakaDate } from "@/core/clock/dates"
import type { Sex } from "@/core/db/schema"
import type { Role } from "@/core/rbac/types"
import type { PersonaSeed } from "@/core/seed/content/personas"
import { createRng } from "@/lib/mock/rng"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/*
 * Deterministic, generated portrait avatars (plan §7.1: synthetic people, no
 * real photos). The same seed always draws the same face, in every window.
 */

const BACKGROUNDS = [
  "#bdeff1",
  "#e4d4fb",
  "#fcd8e9",
  "#f5ebb2",
  "#c8efd7",
  "#cfe3f6",
  "#fbdcc7",
  "#dce0fb",
]
const SKIN = ["#f1c9a2", "#e3b089", "#d19a72", "#bb825c", "#9d6948", "#815437"]
const HAIR = ["#16110f", "#231814", "#31221a", "#402c20"]
const GREY_HAIR = ["#8f8a85", "#a9a49e", "#c9c5bf"]
const CLOTHES = [
  "#2f6fde",
  "#0f81b6",
  "#1f8a70",
  "#6a4c93",
  "#b8435a",
  "#cf7428",
  "#3d4a5c",
  "#138d90",
]
const SCARVES = ["#7b3f61", "#2e5e8c", "#8c5a2e", "#3b6e4f", "#6b4fa0", "#a33d4f"]

type HairStyle = "short" | "long" | "bun" | "scarf" | "receding"

type Look = {
  bg: string
  skin: string
  hair: string
  clothes: string
  scarf: string
  style: HairStyle
  beard: boolean
  glasses: boolean
  coat: boolean
  stethoscope: boolean
}

const COAT_ROLES: Role[] = ["doctor", "pathologist", "pharmacist", "labtech"]

function lookFor(
  seed: string,
  sex: Sex | undefined,
  opts: { age?: number; role?: Role }
): Look {
  const rng = createRng(`avatar:${seed}`)
  const older = (opts.age ?? 0) >= 58
  const bg = rng.pick(BACKGROUNDS)
  const skin = rng.pick(SKIN)
  const hair = older ? rng.pick(GREY_HAIR) : rng.pick(HAIR)
  const clothes = rng.pick(CLOTHES)
  const scarf = rng.pick(SCARVES)
  const style: HairStyle =
    sex === "F"
      ? rng.weighted<HairStyle>([
          ["long", 5],
          ["scarf", 3],
          ["bun", 2],
        ])
      : older && rng.bool(0.4)
        ? "receding"
        : "short"
  return {
    bg,
    skin,
    hair,
    clothes,
    scarf,
    style,
    beard: sex === "M" && rng.bool(older ? 0.55 : 0.3),
    glasses: rng.bool(older ? 0.5 : 0.18),
    coat: !!opts.role && COAT_ROLES.includes(opts.role),
    stethoscope: opts.role === "doctor",
  }
}

export type GeneratedAvatarProps = {
  seed: string
  sex?: Sex
  /** Years; 58 and over greys the hair */
  age?: number
  /** Staff role: clinical roles wear a white coat, doctors a stethoscope */
  role?: Role
  /** Pixel size at 100% scale (rendered in rem, so it follows the UI scale) */
  size?: number
  /** Accessible name */
  title?: string
  className?: string
}

/** A generated head-and-shoulders portrait in a circle. */
export function GeneratedAvatar({
  seed,
  sex,
  age,
  role,
  size = 40,
  title,
  className,
}: GeneratedAvatarProps) {
  // Sanitised so it is safe inside url(#...) whatever React's id format.
  const clipId = `av${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const look = React.useMemo(
    () => lookFor(seed, sex, { age, role }),
    [seed, sex, age, role]
  )
  const { style } = look
  const sizeRem = `${size / 16}rem`

  return (
    <svg
      data-slot="generated-avatar"
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      style={{ width: sizeRem, height: sizeRem }}
      className={cn("shrink-0 rounded-full", className)}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <clipPath id={clipId}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="64" height="64" fill={look.bg} />

        {style === "long" ? (
          <path
            d="M18.5 30C17.5 16 24 10.5 32 10.5S46.5 16 45.5 30L47 47C42 50 22 50 17 47Z"
            fill={look.hair}
          />
        ) : null}

        {/* shoulders: a white coat for clinical roles */}
        <path
          d="M5 64C7 50.5 18.5 44.5 32 44.5S57 50.5 59 64Z"
          fill={look.coat ? "#f3f5f7" : look.clothes}
        />
        {look.coat ? (
          <>
            <path d="M32 45.5 26.8 64h10.4Z" fill={look.clothes} />
            <path
              d="M25.5 45.8 32 54.5 38.5 45.8"
              stroke="#cfd6dd"
              strokeWidth="1.2"
              fill="none"
            />
          </>
        ) : null}
        {look.stethoscope ? (
          <>
            <path
              d="M24.8 47.5C23.2 56 27 59.5 32 59.5S40.8 56 39.2 47.5"
              stroke="#38414c"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="32" cy="59.8" r="1.9" fill="#38414c" />
          </>
        ) : null}

        {style === "scarf" ? (
          <path
            d="M16.5 32C15.5 16 23.5 9 32 9S48.5 16 47.5 32C47.5 41 45 47 40 50.5H24C19 47 16.5 41 16.5 32Z"
            fill={look.scarf}
          />
        ) : (
          <>
            {/* neck with a soft shadow */}
            <path d="M27 35.5V45C29 47.2 35 47.2 37 45V35.5Z" fill={look.skin} />
            <path
              d="M27 35.5V40.5C29.5 42.5 34.5 42.5 37 40.5V35.5Z"
              fill="#000"
              opacity="0.12"
            />
            <ellipse cx="20.8" cy="28.6" rx="2.2" ry="3" fill={look.skin} />
            <ellipse cx="43.2" cy="28.6" rx="2.2" ry="3" fill={look.skin} />
          </>
        )}

        {/* face */}
        <ellipse cx="32" cy="27.6" rx="11" ry="12.8" fill={look.skin} />

        {style === "short" ? (
          <path
            d="M20.6 26C20 15.5 25.5 11.4 32 11.4S44 15.5 43.4 26C42.2 20.4 38.5 17.7 32 17.7S21.8 20.4 20.6 26Z"
            fill={look.hair}
          />
        ) : null}
        {style === "receding" ? (
          <>
            <path d="M20.7 27C20.4 22.5 21.2 19.6 23.4 17.8L24 25Z" fill={look.hair} />
            <path d="M43.3 27C43.6 22.5 42.8 19.6 40.6 17.8L40 25Z" fill={look.hair} />
          </>
        ) : null}
        {style === "long" ? (
          <path
            d="M21 25.5C21.5 16 26.5 12.4 32 12.4S42.5 16 43 25.5C40 19.8 36.2 18.2 32.6 18.6 28.6 19 24.2 21.2 21 25.5Z"
            fill={look.hair}
          />
        ) : null}
        {style === "bun" ? (
          <>
            <circle cx="32" cy="10.8" r="5.2" fill={look.hair} />
            <path
              d="M21 25.5C21.5 16 26.5 12.8 32 12.8S42.5 16 43 25.5C40.5 19.6 36.5 17.6 32 17.6S23.5 19.6 21 25.5Z"
              fill={look.hair}
            />
          </>
        ) : null}
        {style === "scarf" ? (
          <path
            d="M20.8 26.5C20.8 17.6 25.8 13 32 13S43.2 17.6 43.2 26.5C41.5 20.8 37.5 18.4 32 18.4S22.5 20.8 20.8 26.5Z"
            fill={look.scarf}
          />
        ) : null}

        {/* brows and eyes */}
        <path
          d="M25.2 24.4Q27.5 23.2 29.8 24.2M34.2 24.2Q36.5 23.2 38.8 24.4"
          stroke="#2b1e18"
          strokeWidth="1.1"
          strokeLinecap="round"
          fill="none"
          opacity="0.75"
        />
        <ellipse cx="27.6" cy="28.2" rx="1.25" ry="1.45" fill="#221712" />
        <ellipse cx="36.4" cy="28.2" rx="1.25" ry="1.45" fill="#221712" />

        {look.beard ? (
          <path
            d="M21.4 29C21.9 37.6 26.4 41.3 32 41.3S42.1 37.6 42.6 29C41 34.2 37.4 36.8 32 36.8S23 34.2 21.4 29Z"
            fill={look.hair}
          />
        ) : null}
        <path
          d="M28.7 33.7Q32 36 35.3 33.7"
          stroke="#6b3a2e"
          strokeWidth="1.25"
          strokeLinecap="round"
          fill="none"
        />
        {look.glasses ? (
          <g stroke="#1f2328" strokeWidth="1" fill="none">
            <circle cx="27.6" cy="28.2" r="3.3" />
            <circle cx="36.4" cy="28.2" r="3.3" />
            <path d="M30.9 28.2H33.1" />
          </g>
        ) : null}
      </g>
    </svg>
  )
}

/** A persona's avatar (staff seed, sex and role from the persona). */
export function PersonaAvatar({
  persona,
  size = 40,
  className,
}: {
  persona: PersonaSeed
  size?: number
  className?: string
}) {
  const { locale } = useLocale()
  const name =
    persona.staff?.[locale === "bn" ? "nameBn" : "nameEn"] ??
    persona.patientName?.[locale] ??
    persona.id
  return (
    <GeneratedAvatar
      seed={persona.staff?.id ?? persona.patientId ?? persona.id}
      sex={persona.staff?.sex ?? (persona.role === "patient" ? "M" : undefined)}
      role={persona.role === "patient" ? undefined : persona.role}
      size={size}
      title={name}
      className={className}
    />
  )
}

/** A patient's avatar (the patient's `photoSeed`; hair greys with age). */
export function PatientAvatar({
  patient,
  size = 40,
  className,
}: {
  patient: {
    photoSeed?: string
    id?: string
    sex?: Sex
    dob?: string
    nameEn?: string
    nameBn?: string
  }
  size?: number
  className?: string
}) {
  const { locale } = useLocale()
  const age = patient.dob ? ageOn(patient.dob, dhakaDate(now())) : undefined
  const name = locale === "bn" ? (patient.nameBn ?? patient.nameEn) : patient.nameEn
  return (
    <GeneratedAvatar
      seed={patient.photoSeed ?? patient.id ?? name ?? "patient"}
      sex={patient.sex}
      age={age}
      size={size}
      title={name}
      className={className}
    />
  )
}
