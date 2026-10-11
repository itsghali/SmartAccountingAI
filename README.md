# SmartAccountingAI

A modern, multi-tenant SaaS accounting management system built for Moroccan businesses. AtlasCompta implements the Plan Comptable General Marocain (PCGM) and covers the full accounting lifecycle from document intake and human review to journal entries, VAT, and tax declarations.

## Features

- **AI Document Intake & OCR** - Upload invoices, receipts, bank statements, image scans, and PDFs, then extract structured fields into a mandatory human review workflow
- **Human-in-the-Loop Review** - Approve, reject, or correct extracted fields and downstream suggestions before anything becomes actionable in accounting workflows
- **Accounting Entry Assistance** - Generate reviewable journal entry proposals from approved documents and prefill the standard draft-entry flow without auto-posting
- **Tax & VAT Support** - Generate document-level tax classification and VAT guidance while deterministic code computes the final tax result
- **Chart of Accounts (Plan Comptable)** — Full PCGM support with class 1–9 accounts, auxiliary accounts, and tiers management
- **Journal Entry Management** — Double-entry bookkeeping with draft/validated/reversed status lifecycle, auto-numbering, and multi-journal support
- **Fixed Assets (Immobilisations)** — Asset register with linear and degressive amortization calculations, automatic journal generation
- **VAT Management (TVA)** — Monthly and quarterly VAT declarations with rates 7%, 10%, 14%, 20%, credit carry-forward, and XML export
- **Account Reconciliation (Lettrage)** — Match debit and credit lines on tiers accounts with partial reconciliation support
- **Analytical Accounting** — Analytical grids and posts for cost-center tracking, linked to journal entry lines
- **Financial Reports** — Trial balance, general ledger, journal report, aged balance, financial statements (bilan + CPC)
- **Tax Package (Liasse Fiscale)** — Generate and export the annual tax declaration package in DGI-compatible XML format

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI Library | React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Component Library | shadcn/ui |
| Data Fetching | TanStack Query v5 |
| Tables | TanStack Table v8 |
| Forms | React Hook Form + Zod |
| ORM | Prisma 7 |
| Database | PostgreSQL 15 |
| Authentication | NextAuth v5 (JWT strategy) |
| Decimal Precision | decimal.js |
| Charts | Recharts |

## Prerequisites

- **Node.js** 18 or later
- **Docker** and Docker Compose (for the database)
- **PostgreSQL** 15 (via Docker or standalone)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/your-org/SmartAccountingAI.git
cd SmartAccountingAI
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root and fill in your values.

Required variables:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/smartaccountingai"
AUTH_SECRET="your-secret-key-min-32-chars"
NEXTAUTH_URL="http://localhost:3000"
```

Optional agent and document-intake variables:

```env
# Shared model gateway: prefers Groq, then OpenRouter, then OpenAI
GROQ_API_KEY=""
OPENROUTER_API_KEY=""
OPENAI_API_KEY=""

# Optional document-storage / PDF-rendering overrides
PRIVATE_STORAGE_PATH=""
PDF_RENDER_MAX_PAGES="0"
PDF_RENDER_DPI="300"
DOCUMENT_PROCESSOR_PAGE_CHUNK_SIZE="1"
PYTHON_PATH="python"
PDF_RENDER_PYTHON_SCRIPT="scripts/render_pdf_pages.py"
PDFTOPPM_PATH="pdftoppm"
```

For PDF extraction, the OCR flow needs a page renderer. The app first tries the bundled Python script (`scripts/render_pdf_pages.py`) with PyMuPDF available in `PYTHONPATH`, then falls back to `pdftoppm` if it is installed on the machine. By default, all PDF pages are rendered at `300` DPI, multi-page OCR is processed one page at a time before the results are merged, and the OCR prompt explicitly prioritizes financial-table numeric cells over empty template skeletons. For liasse fiscale / état de synthèse candidates, the document processor now performs one automatic financial-table recovery retry and fails the run if usable `financial_tables` still cannot be extracted. The merge step also suppresses blank-page noise and page-scoped header conflicts so multi-page financial documents do not accumulate low-signal warnings as easily. Large liasse fiscale / état de synthèse extractions are then persisted in batched writes so financial-table-heavy documents do not hit short transaction limits as easily.

### 4. Start the database

```bash
docker compose up -d
```

This starts a PostgreSQL 15 container on port `5433`.

### 5. Run database migrations

```bash
npm run db:push
```

### 6. Seed the database

Seeds the PCGM chart of accounts (Plan Comptable Général Marocain):

```bash
npm run db:seed
```

### 7. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

## Production configuration

Copy `production.env.example` to a secret store or an untracked production environment file. Production Compose fails closed when required values are absent. Do not expose PostgreSQL or OCR ports; access them only through the internal Docker network. Rotate any credentials that previously used repository defaults before deploying.

### Default Credentials (Development)

When you seed the database locally, the following test accounts are created with the default password `admin123` (unless overridden in your `.env`):

- **Super Admin:** `superadmin@smartaccountingai.com`
- **Manager / Admin:** `manager@smartaccountingai.com`
- **Accountant:** `accountant@smartaccountingai.com`
- **Viewer:** `viewer@smartaccountingai.com`

**QA Testing Credentials**
Automated QA tests use the following credentials:
- **Email:** `qa-admin-a@example.com`
- **Password:** `Test@1234!`

## Project Structure

```
src/
├── app/                        # Next.js App Router (routing layer)
│   ├── (auth)/                 # Authentication pages (login, register)
│   ├── (dashboard)/            # Protected dashboard pages
│   │   ├── accounts/           # Chart of accounts
│   │   ├── documents/          # Document inbox and review workspace
│   │   ├── approved-documents/ # Human-approved document archive
│   │   ├── entries/            # Journal entries
│   │   ├── journals/           # Journal management
│   │   ├── fixed-assets/       # Fixed asset register
│   │   ├── vat/                # VAT declarations
│   │   ├── analytical/         # Analytical accounting
│   │   ├── reconciliation/     # Account reconciliation
│   │   ├── tax-package/        # Liasse fiscale
│   │   ├── reports/            # Financial reports
│   │   └── settings/           # Company & user settings
│   └── api/                    # REST API endpoints
│       ├── auth/               # Authentication routes
│       ├── agents/             # Generic agent execution and context routes
│       ├── accounts/           # Account CRUD
│       ├── entries/            # Journal entry CRUD
│       ├── companies/          # Company management
│       ├── documents/          # Upload, OCR, review, approval, and downstream generation
│       ├── fiscal-years/       # Fiscal year management
│       ├── fixed-assets/       # Fixed asset + amortization
│       ├── suggestions/        # Reviewable OCR and agent outputs
│       ├── vat/                # VAT declarations
│       ├── analytical/         # Analytical grids & posts
│       ├── reports/            # Report generation endpoints
│       └── tax-package/        # Tax package generation
├── components/                 # Frontend: React UI components
│   ├── accounts/               # Account-specific components
│   ├── entries/                # Entry form components
│   ├── layout/                 # Shell, sidebar, topbar
│   ├── shared/                 # Reusable UI widgets
│   └── ui/                     # shadcn/ui primitives
├── hooks/                      # Frontend: React hooks & context
├── server/                     # Backend: Server-side business logic
│   ├── accounting-entry-preparer/ # Entry proposal workflow from approved documents
│   ├── agents/                 # Agent orchestration, prompts, schemas, and model gateway
│   ├── auth.ts                 # NextAuth configuration
│   ├── document-processor.ts   # OCR/document extraction workflow
│   ├── prisma.ts               # Prisma client singleton
│   ├── storage.ts              # Private document file storage helpers
│   ├── suggestions/            # Suggestion persistence and review history
│   ├── tax-engine/             # Deterministic document tax computation
│   ├── tax-support/            # Tax guidance workflow for approved documents
│   ├── calculations/           # Pure business calculations
│   │   ├── amortization.ts     # Linear & degressive amortization
│   │   ├── balance.ts          # Trial balance computation
│   │   └── vat.ts              # VAT declaration computation
│   ├── validators/             # Zod input schemas
│   │   ├── company.ts
│   │   ├── entry.ts
│   │   └── fiscal-year.ts
│   ├── export/                 # Data export logic (Excel, XML)
│   └── import/                 # Data import parsers
├── lib/                        # Shared: Pure utility functions
│   ├── utils.ts                # cn() and general helpers
│   └── utils/                  # Domain-specific utilities
│       ├── account-helpers.ts
│       ├── currency.ts
│       └── dates.ts
└── types/                      # Shared TypeScript type definitions
    └── index.ts
```

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build production bundle |
| `npm run build:ci` | Run the production build used by CI |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run lint:ci` | Run ESLint and fail on warnings |
| `npm run typecheck` | Run strict TypeScript validation |
| `npm run test` | Run the lightweight Node/TS test suite |
| `npm run test:ci` | Run tests for CI |
| `npm run coverage` | Run tests with coverage reporting |
| `npm run audit:dependencies` | Audit dependencies for high-severity vulnerabilities |
| `npm run db:generate` | Regenerate Prisma client after schema changes |
| `npm run db:migrate` | Apply pending migrations (development) |
| `npm run db:push` | Push schema to DB without migration history |
| `npm run db:seed` | Seed PCGM chart of accounts |
| `npm run db:studio` | Open Prisma Studio database browser |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | Random cryptographic secret used to sign JWT tokens and encrypt sessions (min 32 chars). Supports `NEXTAUTH_SECRET` as legacy fallback. |
| `NEXTAUTH_URL` | Yes | Canonical URL of the application |
| `GROQ_API_KEY` | No | Groq Console API key; enables Groq-backed agent execution and is the preferred provider when configured |
| `GROQ_MODEL` | No | Groq model identifier; defaults to `openai/gpt-oss-120b` |
| `OPENROUTER_API_KEY` | No | Enables OpenRouter-backed agent execution when Groq is not configured |
| `OPENAI_API_KEY` | No | Enables OpenAI-backed agent execution when Groq and OpenRouter are not configured |
| `PRIVATE_STORAGE_PATH` | No | Override the private upload directory for document files |
| `PDF_RENDER_MAX_PAGES` | No | Max number of PDF pages rendered for OCR; `0` means render the full PDF (default `0`) |
| `PDF_RENDER_DPI` | No | Render resolution for PDF pages before OCR (default `300`) |
| `DOCUMENT_PROCESSOR_PAGE_CHUNK_SIZE` | No | Number of rendered PDF pages sent per OCR model call before merge (default `1`) |
| `PYTHON_PATH` | No | Python executable used for the bundled PDF renderer script |
| `PDF_RENDER_PYTHON_SCRIPT` | No | Override path to the PDF-to-PNG rendering script |
| `PDFTOPPM_PATH` | No | Path to a `pdftoppm` binary used as the PDF rendering fallback |
| `NODE_ENV` | No | `development` enables Prisma query logging |

## Documentation

- [Frontend Architecture](docs/frontend.md) — App Router structure, components, state management
- [Backend Architecture](docs/backend.md) — API routes, authentication, business logic
- [Database Guide](docs/database.md) — Schema overview, migrations, seeding
- [Document Intake & OCR Agent](docs/OCR%20Agent.md) — Document extraction and field review workflow
- [Accounting Entry Assistance Agent](docs/Accounting_entry_assist_agent.md) — Entry proposal workflow for approved documents
- [Tax & VAT Support Agent](docs/tax--VAT-agent.md) — Tax guidance and deterministic VAT computation workflow
- [Payroll Support Agent](docs/payroll-support-agent.md) — Target payroll exception-analysis role and current implementation
- [Closing & Reporting Agent](docs/5-closing-reporting-agent.md) — Period-end close checks, reconciliation prompts, and draft reporting workflow
- [Audit, Control & Compliance Agent](docs/6-audit-control-compliance-agent.md) — Audit-focused anomaly detection, user-behavior flags, and read-only compliance support

For OCR debugging, `DocumentExtractionRun.rawOutputJson` stores the validated structured payload, while the model’s raw reply is stored separately on `AgentRun.rawOutput`.
