import type { Metadata, Viewport } from "next"
import { Geist_Mono, Inter, Noto_Sans_Bengali } from "next/font/google"

import "./globals.css"
import { AppProviders } from "@/components/providers"
import { cn } from "@/lib/utils"

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
})

const fontBangla = Noto_Sans_Bengali({
  subsets: ["bengali", "latin"],
  variable: "--font-bangla",
  display: "swap",
})

export const metadata: Metadata = {
  title: "UVTR_MedCore",
  description:
    "A connected hospital operating system demo: identity, OPD, e-prescription, lab, pharmacy, billing, procurement and dashboards. A product of UVTR Infotech.",
  applicationName: "UVTR_MedCore",
  authors: [{ name: "UVTR Infotech", url: "https://uvtrinfotech.com/" }],
  creator: "UVTR Infotech",
  publisher: "UVTR Infotech",
  // A client demo on a public URL: keep it out of search results.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4f7" },
    { media: "(prefers-color-scheme: dark)", color: "#2a282b" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      // No `font-sans` utility here: it lands in the utilities layer and would
      // override the html[lang="bn"] Bangla face. The base layer sets it.
      className={cn(fontSans.variable, fontMono.variable, fontBangla.variable)}
    >
      <body className="bg-background text-foreground">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
