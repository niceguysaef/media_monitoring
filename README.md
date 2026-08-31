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

## Configure Brand24

Copy `.env.example` to `.env` and set:

```bash
BRAND24_API_KEY=your_brand24_api_key
BRAND24_ACCOUNT_ID=your_account_id_for_creating_projects
```

Then restart the FastAPI server. The app discovers available projects with Brand24's account project-list endpoint. Basic projects can also be created in the app with a name, language, keywords, and required/excluded terms. Country, region, and advanced collection settings still need to be managed in Brand24.

## Current API routes

- `GET /api/projects` synchronizes the authoritative Brand24 project list.
- `GET /api/projects/{project_id}/briefing?days=7` returns normalized daily metrics and optional intelligence with partial-failure states.
- `GET /api/projects/{project_id}/mentions` returns a normalized, filterable, cursor-paginated mention feed.
- `GET /api/reference/mention-categories` returns Brand24's supported source filters.
- `POST /api/projects` creates a basic Brand24 project and refreshes the project list.

The backend accepts the response-shape differences observed between Brand24's specification and live API, including `data`/`message` envelopes and empty versus populated project-list shapes.

## Safety limits

The demo backend includes conservative API guardrails:

- Dashboard reads: 20 requests per client per minute.
- Monitor/project creation: 3 requests per client per 5 minutes.
- Saved local monitors: capped at 25 by default.
- Live dashboard responses: cached for 3 minutes to avoid repeatedly fanning out to multiple Brand24 endpoints.
- Brand24 upstream timeout: 10 seconds.

You can change the local monitor cap with:

```bash
MONITOR_LIMIT=25
```
