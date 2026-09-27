# UVTR_MedCore

A connected hospital operating system, built as a demo: patient identity and households, one scheduler and queue, OPD with e-prescription on live pharmacy stock, lab from accession to signed report, pharmacy dispensing, billing with cash control, procurement, dashboards and a white-label patient app.

A product of **[UVTR Infotech](https://uvtrinfotech.com/)**.

It runs entirely in the browser. There is no backend: mock data is seeded into IndexedDB behind an ACID transaction engine, windows in the same browser stay in sync live, and a branch can be taken offline and resynced. All data is synthetic.

## Run

Requires bun 1.3+ and Node 20+.

```bash
bun install
bun run dev        # http://localhost:3000
bun run typecheck
bun run build
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui on Base UI · Motion · Recharts · TanStack Table · Zustand · Dexie (IndexedDB).

Built on the infrastructure of UVTR's earlier demo, [pacifio/hotel-dashboard](https://github.com/pacifio/hotel-dashboard).

---

© UVTR Infotech · [uvtrinfotech.com](https://uvtrinfotech.com/)
