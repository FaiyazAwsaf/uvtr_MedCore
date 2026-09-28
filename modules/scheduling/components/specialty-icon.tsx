import * as React from "react"
import {
  Baby,
  Bone,
  Brain,
  Droplets,
  Ear,
  Eye,
  Hand,
  HeartHandshake,
  HeartPulse,
  Microscope,
  ScanLine,
  Scissors,
  ShieldPlus,
  Smile,
  Stethoscope,
  Syringe,
  Utensils,
  Wind,
  type LucideIcon,
} from "lucide-react"

/** Lucide components for the specialty `icon` names stored in the seed. */
const ICONS: Record<string, LucideIcon> = {
  stethoscope: Stethoscope,
  "heart-pulse": HeartPulse,
  baby: Baby,
  "heart-handshake": HeartHandshake,
  bone: Bone,
  ear: Ear,
  hand: Hand,
  brain: Brain,
  utensils: Utensils,
  droplets: Droplets,
  syringe: Syringe,
  smile: Smile,
  eye: Eye,
  "shield-plus": ShieldPlus,
  scissors: Scissors,
  wind: Wind,
  microscope: Microscope,
  "scan-line": ScanLine,
}

export function specialtyIcon(name: string | undefined): LucideIcon {
  return (name && ICONS[name]) || Stethoscope
}

/** A specialty's icon as an element (the icon component comes from a static map). */
export function SpecialtyIcon({ name, className }: { name: string | undefined; className?: string }) {
  return React.createElement(specialtyIcon(name), { className })
}
