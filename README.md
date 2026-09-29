# UVTR_MedCore

A connected hospital operating system, built as a demo: patient identity and households, one scheduler and queue, OPD with e-prescription on live pharmacy stock, lab from accession to signed report, pharmacy dispensing, billing with cash control, procurement, dashboards and a white-label patient app.

A product of **[UVTR Infotech](https://uvtrinfotech.com/)**.

It runs entirely in the browser. There is no backend: mock data is seeded into IndexedDB behind an ACID transaction engine, windows in the same browser stay in sync live, and a branch can be taken offline and resynced. All data is synthetic.

## Run

Requires bun 1.3+ and Node 20.9+.

```bash
bun install
bun run dev        # http://localhost:3000
bun run typecheck
bun run build
```

## Deploy (Vercel)

There is no server code and there are no environment variables. All pages are static except nine dynamic ones (encounter, dispense, display board, patient 360, report verification and the library detail pages), which run as small Vercel Functions.

1. Import this GitHub repository at [vercel.com/new](https://vercel.com/new) and keep the detected settings: framework Next.js, install `bun install` (from `bun.lock`), build `next build`, Node.js 24.x. No environment variables.
2. `vercel.json` runs the functions in Mumbai (`bom1`), the closest region to Dhaka.
3. Every push to `main` deploys to production. Other branches get preview URLs, which ask for a Vercel login under the default Deployment Protection.

Deploying with the Vercel CLI instead (`bunx vercel`, then `bunx vercel --prod`)? `.vercelignore` keeps internal documents and local tooling out of the upload.

On demo day:

- Demo data lives in the presenting browser, per address. Every preview URL and domain starts with its own fresh data, so rehearse and present on one domain in one Chrome profile (not incognito).
- Open the site once before presenting so the first-visit seed has run, then press **Reset** in the Demo panel.
- Allow pop-ups for the domain once, or the 4-window opener is blocked (the Demo Wall is the fallback).
- Use current Chrome or Edge over HTTPS. Web Locks need a secure context, so never present from a plain `http://` network address.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui on Base UI · Motion · Recharts · TanStack Table · Zustand · Dexie (IndexedDB).

Built on the infrastructure of UVTR's earlier demo, [pacifio/hotel-dashboard](https://github.com/pacifio/hotel-dashboard).

---

© UVTR Infotech · [uvtrinfotech.com](https://uvtrinfotech.com/)
