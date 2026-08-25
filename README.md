# Plant Analytics Portal

Local + Vercel-hostable analytics portal for factory production/downtime/scrap data. Auto-recomputes on new Excel upload.

## Features

- Machine-level dashboards (Cal-1, Cal-2, Lam-1..4, Printing, Blown)
- Direct-to-Blob uploads (bypasses Vercel 4.5MB body cap)
- Client-side PDF report
- Simple email/password auth
- PWA installable on phone
- Dark/light theme toggle
- Optional LLM (Anthropic) narrative

## Stack

Next.js 14 App Router - TypeScript - Recharts - Vercel Blob - SheetJS - jsPDF - Anthropic API (optional)

## Local dev

```
cp .env.example .env.local
# fill values
npm install
npm run seed        # seeds warehouse-local.json from ../Prod. Wastage Down time for July-26/
npm run dev
# open http://localhost:3057 -> login with .env.local credentials
```

## Deploy to Vercel (11fsociety, private)

Step-by-step:

1. `gh repo create 11fsociety/plant-analytics-portal --private --source . --push`
2. In Vercel dashboard: Import GitHub repo
3. Storage tab -> Create Blob store -> copy read/write token
4. Settings > Env Vars - add:
   - BLOB_READ_WRITE_TOKEN (from step 3)
   - PORTAL_EMAIL=apdash13@gmail.com
   - PORTAL_PASSWORD=apdash13
   - SESSION_SECRET (random 32+ char string)
   - Optional: ANTHROPIC_API_KEY
5. Deploy from Vercel dashboard (or `vercel --prod` locally)
6. First-time seed: log in -> Upload page -> drop the 6 Excel files from the July-26 folder. Warehouse builds automatically.

## Warehouse

Single `warehouse.json` blob. Every ingest appends rows with SHA-256 dedup. Re-uploads are safe (no-op). Compaction / migration to Postgres is a future task when warehouse exceeds ~50 MB.

## Auth

Simple session cookie signed with HMAC. Credentials from env vars. Not built for multi-tenant.

## Endpoints

- GET / - dashboard
- GET /machine/[code] - drill-down
- GET /upload - file uploader
- GET /reports - client-side PDF
- POST /api/upload - Vercel Blob signed URL handler
- POST /api/ingest - multipart fallback
- GET /api/data, GET /api/machine/[code]/route.ts - JSON snapshots
