# NoSurprises

NoSurprises is a AI-powered Chrome extension that helps users evaluate Terms and Conditions before accepting them.  
It detects legal pages, extracts relevant text, runs structured risk analysis with Gemini, and shows a clear risk summary with red flags directly inside the extension popup.

## Core Features

- On-demand page analysis from the extension popup (`Analyze this page`).
- T&C detection using URL path and heading signals.
- Legal link discovery fallback (`TC_LINKS_FOUND`) from footer/nav when user is not on a T&C page.
- AI risk analysis with structured output:
  - `riskScore` (0.0-10.0)
  - `riskLabel` (`Low Risk` | `Medium Risk` | `High Risk`)
  - plain-English summary
  - up to 5 evidence-backed red flags.
- Content-hash based cache to avoid repeated AI calls for unchanged documents.
- Change detection (`updatedSince`) when a site’s T&C text changes.
- Local extension state machine with clear UX states:
  - `idle`, `loading`, `ready`, `links_found`, `not_found`, `error`.

## Architecture & System Design

NoSurprises is implemented as a monorepo with three main runtime parts:

- Chrome Extension (Manifest V3):
  - Popup UI (`apps/extension/src/popup`)
  - Background service worker (`apps/extension/src/background/worker.ts`)
  - On-demand content extractor (`apps/extension/src/content/extractor.ts`)
- Backend API:
  - Next.js API route at `POST /api/analyze` (`apps/backend/src/app/api/analyze/route.ts`)
- Data Layer:
  - Supabase Postgres for websites + analysis history.

The system uses shared TypeScript contracts (`packages/contracts`) so extension and backend stay type-consistent (SSOT for API/message/storage shapes).

## System Diagram

```text
Popup (Analyze click)
  -> Background Worker (MV3)
    -> Inject/trigger extractor on active tab
      -> Content extraction
        -> TC_FOUND | TC_LINKS_FOUND | TC_NOT_FOUND

TC_FOUND
  -> Backend /api/analyze
    -> Validate + rate limit + CORS
    -> Cache lookup by domain/hash
    -> Gemini analysis (if cache miss)
    -> Persist to Supabase
  -> Worker stores local state
  -> Popup renders risk result
```

## Backend Design

### API Layer

- `POST /api/analyze` validates request payload, enforces CORS, and applies fixed-window rate limiting (`10 requests / 60s` per `origin:domain` key).
- Errors are normalized into typed error codes:
  - `INVALID_REQUEST`
  - `NOT_ALLOWED_ORIGIN`
  - `RATE_LIMITED`
  - `UPSTREAM_AI_FAILED`
  - `INTERNAL_ERROR`

### Orchestration Layer

`orchestrateAnalyze` coordinates:

1. Fetch latest cached analysis by domain.
2. Canonicalize and hash incoming text.
3. Re-check cache using canonical hash.
4. Call AI analysis on cache miss.
5. Persist latest analysis version atomically.

### AI Analysis Layer

- Model client: Google Gemini (`gemini-2.0-flash`).
- Prompt enforces strict JSON output.
- Schema validation is done with `zod`.
- One retry is attempted if model output is malformed JSON.

### Data Layer (Supabase)

- `websites`: unique domain + latest T&C URL metadata.
- `analyses`: historical analysis versions with `content_hash`, score/label, summary, red flags JSON, timestamp.
- SQL function `save_analysis_version(...)` performs atomic “mark previous latest false + upsert new latest”.

## Tech Stack

- Frontend extension: TypeScript + Vite + Chrome Manifest V3
- Backend: Next.js (API route) + TypeScript
- Validation: Zod
- AI: Google Generative AI SDK (Gemini)
- Database: Supabase (Postgres)
- Tests: Vitest (unit + integration)
- Shared contracts: internal TypeScript package (`packages/contracts`)

## Repository Structure

```text
apps/
  backend/      # Next.js API backend
  extension/    # Chrome MV3 extension (popup + worker + extractor)
packages/
  contracts/    # Shared API/message/storage types (SSOT)
infra/
  supabase/     # SQL migration mirrors for infra tracking
supabase/
  migrations/   # Source-of-truth DB migrations used by Supabase CLI
scripts/
  verify-extension-dist.mjs
  validate-migrations.sh
  sync-supabase-migrations.sh
```

## Local Setup

## Prerequisites

- Node.js 20.x
- npm (commands below use npm)
- Chrome browser
- Supabase project + credentials
- Gemini API key

## 1) Install Dependencies

```bash
cd apps/backend && npm install
cd ../extension && npm install
```

## 2) Configure Environment

### Backend (`apps/backend/.env`)

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEY=...
ALLOWED_ORIGINS=chrome-extension://<EXTENSION_ID>
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` is backend-only and must never be exposed in extension/client code.
- `ALLOWED_ORIGINS` supports comma-separated origins.

### Extension (`apps/extension/.env`)

```env
API_BASE_URL=http://localhost:3000
```

## 3) Apply Database Migrations

From repository root:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## 4) Run Backend

```bash
cd apps/backend
npm run dev
```

Backend should be available at `http://localhost:3000`.

## 5) Build Extension

```bash
cd apps/extension
npm run build
```

This generates `apps/extension/dist`.

## 6) Load Extension in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `apps/extension/dist`
5. Copy the extension ID and update backend `ALLOWED_ORIGINS`
6. Restart backend if `.env` changed

## How the User Flow Works

1. User opens any website and clicks the NoSurprises popup.
2. User clicks `Analyze this page`.
3. Worker injects/activates extractor on the active tab.
4. Extractor emits one of:
   - `TC_FOUND`
   - `TC_LINKS_FOUND`
   - `TC_NOT_FOUND`
5. On `TC_FOUND`, worker calls backend `/api/analyze`.
6. Popup updates to `ready`, `links_found`, `not_found`, or `error`.

## Testing & QA

## Backend

```bash
cd apps/backend
npm run typecheck
npm run test:unit
npm run test:integration
```

## Extension

```bash
cd apps/extension
npm run typecheck
npm run test
npm run test:smoke
```

## Manual E2E Checklist

- Idle -> click `Analyze this page` -> `loading`
- T&C page -> `ready` with risk score + summary + red flags
- Non-T&C page with legal links -> `links_found`
- Non-T&C page with no legal signals -> `not_found`
- Backend/API failure -> `error` with retry action

## Troubleshooting

- `NOT_ALLOWED_ORIGIN`: add exact extension origin to `ALLOWED_ORIGINS`.
- `UPSTREAM_AI_FAILED` + `429 Too Many Requests`: Gemini quota/rate limit reached.
- `Unexpected error while analyzing`: verify backend is running and extension `API_BASE_URL` points to it.
- Popup not reflecting latest code: rebuild extension and reload unpacked extension in Chrome.
