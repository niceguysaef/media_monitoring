# Media Monitoring Demo

A Brand24-backed media intelligence workspace with a FastAPI backend and a Next.js/React frontend.

Brand24 is the source of truth for monitoring projects. The frontend synchronizes the connected account's live project list through the backend, and the API key always remains server-side.

## Run the backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

## Run the frontend

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The frontend is configured as a static Next.js export. `npm run build` writes
the deployable site to `out/`. Local development uses
`NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`; omit that variable when the
frontend and `/api` backend share one production domain.

## Configure Brand24

Copy `.env.example` to `.env` and set:

```bash
BRAND24_API_KEY=your_brand24_api_key
BRAND24_ACCOUNT_ID=your_account_id
```

Then restart the FastAPI server. The app discovers available projects with Brand24's account project-list endpoint. Project creation and configuration are intentionally read-only in this app; create projects and manage keywords, languages, regions, and collection settings in Brand24, then synchronize the project list.

## Private trial access

The app supports a single shared-password gate for a short client trial. It does not create user accounts or embed the configured password in the frontend bundle. Add these server-side values to `.env`:

```bash
TRIAL_ACCESS_PASSWORD=choose-a-strong-shared-password
TRIAL_SESSION_SECRET=replace-with-a-long-random-value
TRIAL_SESSION_HOURS=72
AUTH_COOKIE_SECURE=false
AUTH_COOKIE_SAMESITE=lax
```

Generate a session secret with `openssl rand -hex 32`. Keep `AUTH_COOKIE_SECURE=false` for local HTTP development, then set it to `true` for the HTTPS deployment. Leaving `TRIAL_ACCESS_PASSWORD` empty disables the gate.

The backend validates the password and returns a signed, HTTP-only session cookie. The monitoring API key and shared password remain server-side. If the frontend and backend are deployed on unrelated domains, use `AUTH_COOKIE_SAMESITE=none` with `AUTH_COOKIE_SECURE=true`; hosting them under the same site is more reliable.

## Current API routes

- `GET /api/projects` synchronizes the authoritative Brand24 project list.
- `GET /api/projects/{project_id}/briefing?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD` returns normalized daily metrics, previous-period comparisons, and optional intelligence with partial-failure states.
- `GET /api/projects/{project_id}/mentions` returns a normalized, filterable, cursor-paginated mention feed.
- `GET /api/projects/{project_id}/sources` aggregates domains, links, hashtags, authors, active sites, and hot hours with partial-failure handling.
- `GET /api/projects/{project_id}/topics` returns normalized Brand24 topic clusters, reach, mentions, share of voice, and sentiment composition.
- `POST /api/projects/{project_id}/exports` builds an Excel workbook, editable PowerPoint deck, or printable PDF report from a live 31-day-or-shorter monitoring snapshot.
- `GET /api/reference/mention-categories` returns Brand24's supported source filters.

The backend accepts the response-shape differences observed between Brand24's specification and live API, including `data`/`message` envelopes and empty versus populated project-list shapes.

The frontend uses one shared 7-, 14-, or 30-day reporting period across Briefing, Mentions, Sources, Topics, and exports. Briefing metrics include a cached comparison with the immediately preceding period, and export presentation preferences are retained locally in the browser.

## Safety limits

The backend includes persistent, conservative API guardrails:

- All API traffic: 90 requests per client per minute and 240 total requests per minute.
- Briefing reads: 12 requests per client per minute.
- Mention reads: 30 requests per client per minute.
- Source and topic reads: 10 requests per client per minute each.
- Exports: 2 requests per client per 10 minutes.
- Actual upstream calls: 250 per hour and 1,500 per day across the application.
- Upstream concurrency: at most 8 active requests, with a 10-second timeout.
- Live briefing, source, and topic responses are cached for 3 minutes.
- Limits are stored in SQLite so restarts and multiple workers on one host do not reset them.

The deployment limits can be adjusted in `.env`:

```bash
RATE_LIMIT_DB_PATH=data/request_limits.sqlite3
UPSTREAM_TIMEOUT_SECONDS=10
UPSTREAM_MAX_CONCURRENCY=8
UPSTREAM_HOURLY_REQUEST_LIMIT=250
UPSTREAM_DAILY_REQUEST_LIMIT=1500
TRUST_PROXY_HEADERS=false
CORS_ALLOWED_ORIGINS=https://your-frontend.example.com
```

Only set `TRUST_PROXY_HEADERS=true` when the deployment is behind a trusted reverse proxy that overwrites `X-Forwarded-For`; otherwise clients can forge that header to evade per-client limits.

Set `CORS_ALLOWED_ORIGINS` to the exact deployed frontend origin (or a comma-separated list). Do not use `*` for the public deployment.

PowerPoint export uses `python-pptx` and runs entirely inside the FastAPI process. No Node.js runtime or external presentation service is required by the backend.

PDF export uses ReportLab for generation and pypdf/pdfplumber for validation. These dependencies are installed through `requirements.txt`.
