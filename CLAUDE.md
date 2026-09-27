# UVTR_MedCore

## Project brief

- **What:** a frontend-only demo of a hospital operating system (EHR, HMS, ERP and a patient app) for a multi-branch private hospital network in Bangladesh. Built by UVTR Infotech.
- **Client:** the real client is Ibn Sina, but the app stays generic until the owner says otherwise. Hospital-facing surfaces use the placeholder brand "City Care Hospitals" from `config/brand.config.ts`. The staff app is branded UVTR_MedCore.
- **How it works:** there is no backend. Mock data is seeded in the browser and stored in IndexedDB behind an ACID transaction engine:
  - atomic multi-table commits
  - invariants checked before commit
  - a serial commit queue with per-record versions
  - durable storage
  - an append-only event log and a hash-chained audit trail

  Windows in the same browser sync live (Dexie `liveQuery` plus BroadcastChannel). "Branch offline" is a real data partition, with ordered replay on reconnect.

- **How it is demoed:**
  - on a 1920x1200 monitor, with 4 windows or the Demo Wall (a 2x2 grid of panes in one tab)
  - each window has its own persona (role, staff member, branch) and its own language (EN or BN)
  - scenario launchers set up each exception so the presenter can perform it live
- **Deadline:** demo-ready by 30-09-2026. **Deploy target:** Vercel.

## Key documents

| Path                                                       | What it is                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/implementation_plan.md`                              | **Source of truth.** Follow the phases in order and tick checkboxes when a step is verified.                                                            |
| `docs/progress_log.md`                                     | **Progress log** maintained by the owner and Claude. Updated after every change, including plan deviations (rule 4).                                    |
| `docs/objective.md`                                        | The owner's feature list and demo run.                                                                                                                  |
| `docs/ui_guidelines.md` and `sample_ui/`                   | The only visual reference (dark theme, turquoise accent, gradient KPI cards).                                                                           |
| `UVTR Hospital OS PRD+Security Concerns+Other details.pdf` | PRD v10. Internal: read it as needed (§9, §10, §16, §20, §22 matter most), **never commit it**.                                                         |
| Base project                                               | [pacifio/hotel-dashboard](https://github.com/pacifio/hotel-dashboard) at `6c9d3d8`. We use its stack and infrastructure, **not its UI**. See plan §2.1. |

## How to run

Requires bun 1.3+ and Node 20.9+ (the Next 16 minimum).

```bash
bun install
bun run dev          # http://localhost:3000 (launcher)
bun run typecheck    # tsc --noEmit
bun run lint         # ESLint 9: 0 errors expected (1 accepted TanStack Table warning)
bun run test         # vitest: unit, i18n and engine tests
bun run e2e          # Playwright smoke tests; builds and serves on port 3100
bun run build        # production build; must pass before every merge
bun run format       # prettier
bun run i18n:check   # EN/BN key parity, no empty strings, no em dashes
bun run i18n:export  # writes docs/bangla-strings-review.md for a fluent reviewer
```

Useful routes:

| Route         | Screen                                       |
| ------------- | -------------------------------------------- |
| `/`           | Launcher: role cards and the 4-window opener |
| `/wall`       | Demo Wall                                    |
| `/app`        | Patient app                                  |
| `/display/B1` | Queue display board                          |

Reset the demo data, move the demo clock and cut or restore a branch's internet from the **Demo panel** in the top bar.

## Rules

1. **Never use em dashes**, anywhere: code, comments, UI strings (English and Bangla), docs, commit messages and chat replies. Use commas, colons, semicolons, parentheses or separate sentences instead.
2. **Commit messages are one line**, as `type: summary`, where type is one of `feat`, `fix`, `chore`, `docs`, `test` or `refactor`. No body, no trailers.
3. **Clarify when necessary.** If a requirement is ambiguous or the decision belongs to the owner, ask one focused question with a recommended answer before building. Don't ask about things the plan, docs or code already answer.
4. **Update `docs/progress_log.md` after every change.** Append a row to its table (`Date | Phase / step | Note`, date as DD-MM-YYYY) saying what changed and what's next. Do it in the same step as the change, before committing. Plan deviations are logged there too. Keep the owner's table format.

## Engineering rules

- **Data access:**
  - Write only through `commit()` commands.
  - Read through `useDb()` and `useLiveQuery`.
  - Get time only from the demo clock `now()`, never `Date.now()` or `new Date()` in domain code.
- **Strings:** every user-visible string lives in the module's `i18n/en.ts` **and** `i18n/bn.ts`. Use the `lib/i18n` formatters for money, dates and numbers. Identifiers (UHID, invoice, Rx, accession, PO) always use Latin digits.
- **Screen size:** every staff screen must be usable at 960x600.
- **Visuals:** design only from `docs/ui_guidelines.md`. Never reuse the base project's (Auberge's) look. Restyle base primitives through tokens.
- **Branding:** hospital names and logos come only from `config/brand.config.ts`. The patient app is never UVTR-branded.
- **Seed data:**
  - Synthetic people only.
  - **All doctors are male.**
  - Medicines use real Bangladeshi brand names with our own mock prices, DAR numbers and monographs. Nothing is copied from Medex.
- **Guardrails** (plan §11):
  - Tier 3 screens carry the "Release 3 roadmap" label, and telemedicine carries "Release 2".
  - No automation that diagnoses, prescribes, substitutes or ranks medicines.
  - A "Simulated" badge on every external connector.
  - SMS and notifications carry no clinical content.
- **Next.js 16 has breaking changes:** read `node_modules/next/dist/docs/` before writing routing, layout or config code.
- **Parallel agents** edit only the paths their workstream owns (plan §13). Shared files (`core/`, `components/shared/`, registries, schema) belong to the main agent.
- **Git:**
  - Commit after each verified slice.
  - Never push without the owner's explicit go-ahead.
  - Never commit PDFs.
  - **`docs/` is local only.** It is gitignored and must never be committed or reach GitHub. Never force-add it.
- **Worktree agents:** `docs/` doesn't exist inside a git worktree. Read it from the main checkout by absolute path: `/home/fawsaf/projects/werk/uvtr/hospital-os/docs/` (`implementation_plan.md`, `ui_guidelines.md`, `objective.md`, `progress_log.md`).
