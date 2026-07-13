# url-shortener

A self-hosted URL shortener with a clean, minimal UI and a full REST API. Designed to be deployed behind a single domain (e.g. `https://hct.gg`) via Docker Compose — Coolify-friendly out of the box.

## How it works

The app serves everything from one domain — the same domain you deploy it under is the domain used for short links:

| Path | Purpose |
|---|---|
| `/:code` | Public redirect — the short link itself (e.g. `https://hct.gg/abc123`) |
| `/` | Landing page / login |
| `/dashboard` | Admin dashboard (create/manage links, view stats, manage API keys) |
| `/api/*` | REST API (Bearer token auth via API key) |
| `/docs` | **Public** interactive API documentation (share this link with humans and AI agents) |
| `/openapi.json` | Machine-readable OpenAPI 3.1 spec |
| `/llms.txt` | Plain-text API summary optimized for LLM/agent consumption |
| `/healthz` | Health check endpoint |

Short codes are generated so they never collide with reserved paths (`api`, `dashboard`, `login`, `docs`, `assets`, `healthz`, etc. — see `CLAUDE.md` for the full list). Custom aliases are validated against the same reserved list.

## Features

- **Simple, beautiful UI** — minimal dashboard, dark/light theme, mobile-friendly
- **Click analytics** — account-wide and per-link charts, 7-day default with 14/30/90-day ranges, per-day breakdown, top referrers, 7-day sparklines in the link list
- **Fully API-enabled** — everything the dashboard can do, the API can do
- **API key auth** — standard `Authorization: Bearer <key>` header; keys are created and revoked in the dashboard and stored hashed
- **Public API docs** — interactive docs at `/docs` (self-hosted Scalar, no CDN), spec at `/openapi.json`, agent-friendly summary at `/llms.txt`
- **Custom aliases** — choose your own short code or let the app generate a 6-char base58 one
- **QR codes** — SVG QR code for every link, in the UI and via API
- **Editable destinations** — redirects are 302, so a short code can be repointed any time
- **Single-container, SQLite-backed** — no external database needed; data lives in one volume

## Quick start (Docker Compose / Coolify)

```bash
cp .env.example .env   # set ADMIN_PASSWORD and APP_URL
docker compose up -d
```

In Coolify: create a new Docker Compose resource pointing at this repo, set the environment variables from `.env.example`, and assign your domain (e.g. `https://hct.gg`). The domain you assign is the domain short links are minted on.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | yes | Public base URL of the deployment, e.g. `https://hct.gg`. Used when minting short links. |
| `ADMIN_PASSWORD` | yes | Password for the admin login. |
| `SESSION_SECRET` | yes | Random string used to sign session cookies. Generate with `openssl rand -hex 32`. |
| `PORT` | no | Internal listen port (default `3000`). |
| `DATA_DIR` | no | Directory for the SQLite database (default `/data`). |

## API in 30 seconds

```bash
# Create a short link
curl -X POST https://hct.gg/api/links \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/very/long/url", "code": "optional-custom-alias"}'

# → {"code": "abc123", "shortUrl": "https://hct.gg/abc123", "url": "https://example.com/very/long/url", ...}
```

Full documentation lives at `https://<your-domain>/docs` once deployed. The draft spec is in [`docs/openapi.yaml`](docs/openapi.yaml).

## Development

Requires Node.js 22+.

```bash
npm install
npm run build          # build frontend + server (needed once so the SPA exists)
npm run dev            # server on http://localhost:3000 with dev defaults (password: admin)
npm test               # run the Vitest suite
node scripts/seed-demo.mjs   # optional: seed demo links + clicks into ./data
```

Stack: Fastify + better-sqlite3 on the server, a Vite vanilla-TypeScript SPA for the dashboard, hand-rolled SVG charts. See `CLAUDE.md` for architecture and conventions.

## License

MIT
