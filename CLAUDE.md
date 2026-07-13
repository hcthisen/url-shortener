# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

A self-hosted URL shortener deployed as a single Docker container (via `docker-compose.yaml`, hosted on Coolify). The domain the app is deployed under **is** the short-link domain: deployed at `https://domain.com`, it mints links like `https://domain.com/abc123`. One app serves the redirects, the dashboard UI, the REST API, and the public API docs.

## Architecture decisions (the contract — do not deviate without asking)

- **Runtime:** Node.js 22, TypeScript.
- **Server:** Fastify. Single process serves API + static frontend + redirects.
- **Database:** SQLite via `better-sqlite3`, file stored in `DATA_DIR` (default `/data`, a Docker volume). No external DB. Schema migrations run automatically on startup.
- **Frontend:** Vite + vanilla TypeScript + modern CSS (no heavy framework). Built to static assets served by Fastify. Design goal: super clean and minimal — generous whitespace, one accent color, system font stack or a single webfont, dark-mode aware.
- **Container:** Multi-stage Dockerfile (build frontend + TS, then slim runtime image). `docker-compose.yaml` defines the service with a named volume for `/data`.

## URL routing & reserved paths

Everything hangs off one domain. Route resolution order:

1. Exact reserved paths/prefixes (see list below) → app pages / API.
2. `GET /:code` → look up short code → 301/302 redirect (record click) → 404 page if unknown.

**Reserved top-level path segments** (short codes must never be generated with these, and custom aliases must be rejected if they match):

```
api, dashboard, login, logout, docs, openapi.json, llms.txt,
assets, static, healthz, favicon.ico, robots.txt
```

Keep this list in ONE place in the code (e.g. `src/reserved.ts`) and use it for both routing and alias validation.

Short codes: 6-char base58 (no `0OIl`) by default; custom aliases allow `[a-zA-Z0-9_-]{1,64}`.

## Auth model

- **Dashboard (humans):** single admin user. Login with `ADMIN_PASSWORD` env var → signed stateless session cookie (HMAC, `SESSION_SECRET`). The SPA calls `/api/*` using this cookie.
- **API (machines):** API keys, sent as `Authorization: Bearer <key>`. Keys are created/revoked in the dashboard. Only a SHA-256 hash is stored; the plaintext is shown once at creation. Key format: `sk_<40 random base58 chars>`.
- `/api/*` accepts **either** a valid Bearer key or the admin session cookie — except `/api/keys*`, which requires the session (an API key must never mint or revoke keys).
- Public, no auth: redirects (`/:code`), `/docs`, `/openapi.json`, `/llms.txt`, `/healthz`, `/robots.txt`, login page.
- Login is throttled (5 attempts/minute/IP, in-memory).

## API conventions

- All API routes under `/api/` (this prefix is reserved and never a short code).
- JSON in/out. Errors: `{ "error": { "code": "...", "message": "..." } }` with proper HTTP status.
- The OpenAPI 3.1 spec in `docs/openapi.yaml` is the source of truth — update it in the same PR as any API change. It is served at `/openapi.json` and rendered interactively at `/docs` (use Scalar API Reference, self-hosted assets only — no CDN, so it works air-gapped).
- `/llms.txt` is a concise plain-text description of the API for AI agents — keep it in sync too.
- Short URLs in API responses are built from the `APP_URL` env var (never from the Host header — avoids header-injection issues behind proxies).

### Core resources

- `POST /api/links` — create (url required; optional code, note)
- `GET /api/links` — list (paginated, searchable; items include a 7-day `sparkline`)
- `GET /api/links/:code` — read (includes click count)
- `PATCH /api/links/:code` — update destination/note
- `DELETE /api/links/:code` — delete
- `GET /api/links/:code/stats` — click stats (`?days=` 1–365, default 7; zero-filled `clicksByDay`, `topReferrers`)
- `GET /api/links/:code/qr` — QR code as SVG
- `GET /api/stats` — account-wide stats (`?days=`; `clicksByDay`, `topLinks`)
- `GET/POST/DELETE /api/keys` — API key management (session only)

## Project layout

```
src/            Fastify server: config, db, auth, stats, reserved paths, routes/
frontend/       Vite vanilla-TS SPA (login, dashboard, link detail, API keys) + charts
tests/          Vitest suites (core units + full HTTP flows via fastify.inject)
docs/           openapi.yaml (source of truth), llms.txt (served at /llms.txt)
scripts/        copy-scalar.mjs (build), seed-demo.mjs (dev data)
Dockerfile      multi-stage build; docker-compose.yaml runs it with a /data volume
```

## Dev workflow

- `npm run dev` — tsx watch on the server (serves the last built frontend from `dist/public`)
- `npm run build` — tsc + vite build + copy Scalar bundle to `dist/public/vendor/`
- `npm test` — Vitest; `npm start` — run the built server
- `node scripts/seed-demo.mjs` — seed demo links/clicks into the dev DB (`./data`)
- Dev defaults when `NODE_ENV !== production`: `APP_URL=http://localhost:3000`, `ADMIN_PASSWORD=admin`. Production fails fast without real env vars.
- Charts are hand-rolled SVG in `frontend/src/charts.ts` — single accent series, hairline grid, crosshair tooltip. Dark/light both use the CSS custom properties in `styles.css`; keep chart colors reading from those tokens.

## Conventions

- TypeScript strict mode everywhere.
- Environment variables are read once at startup into a validated config object; fail fast with a clear message if required vars are missing.
- Never log full API keys or the admin password.
- Redirects use 302 (temporary) by default so destinations stay editable; clicks are recorded asynchronously so redirects stay fast.
- Tests: Vitest. At minimum cover: reserved-path validation, code generation, auth (both mechanisms), and the redirect flow.

## Deployment notes (Coolify)

- Coolify deploys the `docker-compose.yaml` and injects the domain; `APP_URL` must be set to that domain.
- The app must be reverse-proxy friendly: listen on `0.0.0.0:$PORT`, trust `X-Forwarded-*` only for logging (not for minting URLs — that's `APP_URL`'s job).
- `/healthz` returns 200 with `{"status":"ok"}` for health checks.
