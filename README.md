# Staff Room OS

A client-distributable web dashboard on top of [HERMÉS Agent](https://github.com/NousResearch/hermes-agent). Wraps the CLI-only autonomous agent runtime in a friendly UI so non-technical staff at client companies can spin up, monitor, and delegate to AI employees — without a terminal.

**Status: v1.1 feature-complete.** 14 pages, 13 API surfaces, 2 HERMÉS plugins (Composio + audit), real Composio OAuth, scheduled agents, webhook triggers, audit log, approvals visibility, encrypted secrets vault, Claude Code memory bridge, analytics, backup. Sellable to a first paying client. See [docs/PRD.md](docs/PRD.md) for the full roadmap.

---

## Architecture

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Next.js 15  │ ─► │  FastAPI bridge  │ ─► │  HERMÉS runtime  │
│  $PORT       │    │  :8787 internal  │    │  (vendored)      │
└──────────────┘    └──────────────────┘    └──────────────────┘
       │                  │                       │
       │  proxies /api/*  │  reads state.db ro    │  spawns chat /
       │                  │  manages agents.yaml  │  gateway / cron
       │                  │  vault.enc encrypts   │  webhook adapter
       ▼                  ▼                       ▼
   /wh/{name}  ────────────────────────►  HERMÉS webhook adapter :8644
   (public proxy for external webhooks like Stripe/GitHub)

Volume: /data/hermes + /data/staffroom (Railway Volume on prod)
```

**Single-container, single-tenant.** Both Python (bridge) and Node (Next.js) run in one Docker image, both behind the Railway public port. The bridge isn't exposed externally — Next.js proxies `/api/*` with the bearer token attached server-side, so the browser never sees the token.

---

## What's wired

### Pages (sidebar)
| | Page | What |
|---|---|---|
| | Welcome | Onboarding checklist that auto-detects what's set up — clear "Next: …" CTA until you're live |
| | Overview | Headline counters: agents, sessions today, cost (today + 30d), skills installed |
| | Agents | Card grid, add/start/stop/delete, OpenRouter model picker, system prompt + toolset selection |
| | Tasks | HERMÉS kanban queue + dashboard-side queue, delegate a task to any agent |
| | Activity | Two views: HERMÉS sessions table OR live audit feed (color-coded events, filterable) |
| | Log | Live tail of HERMÉS + agent logs (2s polling, works through any proxy) |
| | Schedules | Wraps HERMÉS cron — cron / interval / one-shot, pre-baked recipes, pause/resume/trigger |
| | Webhooks | Manage HERMÉS dynamic subscriptions, public URL via `/wh/{name}`, 4 templates (Stripe / GitHub / form / monitoring) |
| | Approvals | Pending-approval visibility derived from audit log (response still via CLI / Telegram in v1) |
| | Integrations | **Composio** (250+ apps, OAuth flow), Telegram / Slack / Discord / OpenRouter / Anthropic / OpenAI credentials, gateway daemon start/stop |
| | Skills | Searchable catalog of installed SKILL.md files |
| | Analytics | Cost / tokens / sessions by day / model / source / agent — 7d / 30d / 90d toggle |
| | Settings | Bearer token reveal & rotate, paths, env, Backup download, Claude Code MCP config snippet |
| | (Goals, Knowledge, Experiments are placeholders for v1.2.) | |

### Bridge HTTP API
| Path | Notes |
|---|---|
| `GET /api/health` | Public; the Railway healthcheck |
| `GET /api/overview` | Aggregated counters |
| `*  /api/agents` | CRUD + start/stop |
| `*  /api/tasks` | List + create (kanban + local queue) |
| `GET /api/activity` | Recent sessions |
| `GET /api/logs[, /tail, /stream]` | List + tail; WebSocket stream available |
| `*  /api/schedules` | HERMÉS cron wrap |
| `*  /api/webhooks` | HERMÉS webhook subscriptions |
| `GET /api/approvals[, /history]` | Audit-derived pending list |
| `GET /api/audit[, /days]` | Read JSONL audit trail |
| `GET /api/analytics` | Cost/tokens/sessions aggregates |
| `*  /api/integrations` | Provider credentials, transparently vault-encrypted when STAFFROOM_SECRETS_KEY set |
| `*  /api/composio` | Toolkits, connections, connect (OAuth), disconnect |
| `*  /api/vault` | List/set/delete encrypted secrets directly |
| `*  /api/settings` | Token, MCP config snippet, **backup .tar.gz**, rotate-token |
| `GET /api/skills` | Catalog |

All auth-gated routes require `Authorization: Bearer <token>`. The Next.js catchall route at `app/api/[...path]` injects the token server-side. `/api/health` and `/wh/[...]` are intentionally public.

### HERMÉS plugins shipped in `plugins/`
- **`composio`** — exposes 3 tools to HERMÉS agents: `composio_list_apps`, `composio_list_actions`, `composio_execute`. Inherits the operator's Composio OAuth connections so agents can call Gmail/Slack/Stripe/HubSpot/etc.
- **`staffroom-audit`** — subscribes to 6 HERMÉS lifecycle hooks (`on_session_start`, `on_session_end`, `pre_tool_call`, `post_tool_call`, `pre_approval_request`, `post_approval_response`) and appends one JSON line per event to `$STAFFROOM_HOME/audit/{YYYY-MM-DD}.jsonl`. Powers the Activity audit feed, Approvals tab, per-agent task attribution, and analytics by-agent.

Both auto-symlinked into `$HERMES_HOME/plugins/` and added to `plugins.enabled` in `config.yaml` by `scripts/start.sh` on container boot.

### Encrypted secrets vault

When `$STAFFROOM_SECRETS_KEY` (urlsafe-base64 of 32 random bytes) is set:
- Credentials saved via the Integrations UI go to `$STAFFROOM_HOME/vault.enc` (libsodium secretbox), 0600 perms
- On bridge startup, the vault is decrypted and exported to `os.environ` so HERMÉS subprocesses inherit secrets without plaintext on disk
- Explicit Railway Variables always take precedence — the vault never overwrites them
- Pre-existing `~/.hermes/.env` entries continue to work (read merge) until you re-save them through the UI

---

## Deploy on Railway

1. **railway.com → New Project → Deploy from GitHub repo → `hermes-dash`**. Railway reads `railway.json` and uses the Dockerfile.
2. **Settings → Volumes → New Volume** → mount path `/data`.
3. **Variables** — minimum:
   - `OPENROUTER_API_KEY` — from openrouter.ai/keys
   - `COMPOSIO_API_KEY` — from composio.dev (unlocks 250+ apps)
   - `STAFFROOM_SECRETS_KEY` — `python -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('='))"` — enables encrypted vault
   - `PUBLIC_BASE_URL` — your Railway domain, e.g. `https://your-app.up.railway.app` — used for webhook URLs displayed in the dashboard
4. **Settings → Networking → Generate Domain.** Healthcheck is on `/api/health`.
5. Open the URL → land on `/welcome` → follow the checklist.

That's it. Bearer token + Bridge auth are auto-minted into `/data/staffroom/token`. Visible in Settings.

---

## Local dev

```bash
./installer/install.sh   # one-time: deps + venv + npm
./installer/run.sh       # bridge + web on :8787 + :3737
```

Open http://localhost:3737. Set `STAFFROOM_AUTH_DISABLED=1` to bypass the bearer-token wall for local fiddling.

---

## Layout

```
staff-room-os/
├── apps/
│   ├── bridge/                 FastAPI service (Python 3.11+)
│   │   ├── auth.py             bearer-token auth
│   │   ├── vault.py            libsodium secretbox encrypted vault
│   │   ├── composio_link.py    singleton Composio client + STAFFROOM_USER_ID
│   │   ├── hermes_client.py    agent process registry + state.db reads
│   │   └── routers/            agents, tasks, activity, logs, skills,
│   │                            schedules, webhooks, approvals, audit,
│   │                            analytics, composio, integrations, vault,
│   │                            settings, overview
│   └── web/                    Next.js 15 (App Router)
│       ├── app/                14 pages + /api/[...path] proxy + /wh/[...path]
│       ├── components/         sidebar, topbar, agent-card, composio-panel, …
│       └── lib/api.ts          typed client (single source of truth for endpoints)
├── plugins/
│   ├── composio/               HERMÉS plugin: 3 agent-callable tools
│   └── staffroom-audit/        HERMÉS plugin: 6 lifecycle hooks → JSONL
├── vendor/hermes-agent/        pinned MIT fork (commit in HERMES_COMMIT.txt)
├── installer/                  install.sh + run.sh + Dockerfile + compose
├── scripts/start.sh            single-container boot: plugin symlinks + bridge + web
├── Dockerfile                  multi-stage node build + python runtime
├── railway.json                Railway deploy config (Dockerfile builder, /api/health)
└── docs/PRD.md                 v1.0 → v2.0 roadmap with status markers
```

---

## Caveats — read before pitching

- **"Self-learning skills" is marketing, not code.** HERMÉS skills are static SKILL.md files agents consume; there's no auto-generation pipeline in the repo today. Pitch as *autonomous execution with a curated and Composio-expandable skillset.*
- **Agent spawn command is the fragile seam.** `hermes chat --non-interactive …` may need tuning per HERMÉS release. If subprocess args drift, edit `apps/bridge/hermes_client.py::start_agent`.
- **Single-tenant.** Bearer-token auth protects the bridge, but there's no per-user accounts or RBAC. Each client gets a dedicated Railway deploy. Multi-tenant SaaS is explicitly v2.
- **Approvals tab is visibility-only in v1.** Operator sees pending approvals in real time; response still happens at the surface that raised the prompt (CLI, Telegram inline buttons, Slack message reply). Dashboard-side approve/deny needs a small HERMÉS fork; it's v1.1+.
- **Per-channel agent overrides not yet supported.** HERMÉS gateway is one-agent-per-process. For multi-channel, spawn multiple gateway daemons with separate `HERMES_HOME` dirs. Native multiplexing is §1.2.1 in the PRD.

---

## License

Staff Room OS code: MIT. Vendored HERMÉS Agent: MIT (Copyright (c) 2025 Nous Research). See `vendor/hermes-agent/LICENSE`.
