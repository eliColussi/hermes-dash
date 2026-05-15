# Staff Room OS

A client-distributable web dashboard on top of [HERMÉS Agent](https://github.com/NousResearch/hermes-agent). Wraps the CLI-only autonomous agent runtime in a friendly UI so non-technical staff at client companies can spin up, monitor, and delegate to AI employees.

**Status: v0.1 scaffold — works end-to-end against a running HERMÉS install, with the agent runtime managed via subprocess.**

## Architecture

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Next.js 15  │ ─► │  FastAPI bridge  │ ─► │  HERMÉS runtime  │
│  :3737       │    │  :8787           │    │  (vendored)      │
└──────────────┘    └──────────────────┘    └──────────────────┘
                          │  reads
                          ▼
                    ~/.hermes/state.db (SQLite, read-only)
                    ~/.hermes/skills/  (filesystem)
                    ~/.staff-room-os/  (our agent definitions + pids)
```

The bridge never writes to HERMÉS state. It:
- Reads `~/.hermes/state.db` read-only for sessions, costs, tool calls.
- Manages its own agent definitions in `~/.staff-room-os/agents.yaml`.
- Spawns `hermes chat` subprocesses for each running agent, tracked by pidfiles in `~/.staff-room-os/runtime/`.
- Scans `~/.hermes/skills/` (and the vendored fallback) for available SKILL.md files.

This keeps the bridge resilient to upstream HERMÉS refactors at the cost of not driving agents turn-by-turn from the dashboard (a v2 concern).

## Layout

```
staff-room-os/
├── apps/
│   ├── bridge/       FastAPI service (Python 3.11+)
│   └── web/          Next.js 15 dashboard
├── vendor/
│   └── hermes-agent/ Pinned MIT-licensed fork of NousResearch/hermes-agent
└── installer/        install.sh, run.sh, docker-compose.yml
```

Pinned HERMÉS commit: see `vendor/HERMES_COMMIT.txt`.

## Deploy on Railway / Render / any Docker host

The repo ships a single-container `Dockerfile` that runs both services. The Next.js app binds to `$PORT` (Railway's contract); the FastAPI bridge runs on internal `127.0.0.1:8787` and the web proxies `/api/*` to it with the bearer token attached server-side.

### Railway

1. New Project → Deploy from GitHub → pick `hermes-dash`.
2. Railway auto-detects `railway.json` and uses the Dockerfile.
3. Add a **Volume** mounted at `/data` so HERMÉS state and the auth token survive restarts.
4. Set these env vars (all optional — sensible defaults exist):
   - `STAFFROOM_AUTH_TOKEN` — pin a stable token. Otherwise one is generated on first boot and persisted in `/data/staffroom/token`.
   - `STAFFROOM_CORS_ORIGINS` — comma-separated origins if you want to call the bridge directly from a custom frontend.
   - Provider creds (`TELEGRAM_BOT_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, etc.) — these can also be set later from the Integrations tab.
   - Model creds (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, …) — required for agents to do anything.
5. Healthcheck path is `/api/health`.
6. Open the Railway-provided URL. The Settings page shows your token.

### Self-hosted Docker

```bash
docker build -t hermes-dash .
docker run -d --name hermes-dash \
  -p 3737:3737 \
  -v hermes-dash-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  hermes-dash
```

Open http://localhost:3737. The auto-minted bearer token is in `/data/staffroom/token` inside the container.

## Quickstart

```bash
./installer/install.sh
./installer/run.sh
```

Open http://localhost:3737.

You'll see three seeded example agents (Analyst, Boss, Captain). Add more via the **Add Agent** tile on the Agents page.

## v1 scope

Sidebar items that are wired up:
- **Welcome** — onboarding placeholder
- **Overview** — counts of agents, sessions, cost (today + 30d), tool calls, skills installed
- **Agents** — card grid matching the mock; create, start, stop, delete
- **Tasks** — delegate a task with optional agent target; lists local + HERMÉS kanban tasks
- **Activity** — recent HERMÉS sessions with cost / tool-call / message counts
- **Log** — live WebSocket tail of `~/.hermes/logs/*.log` + per-agent stdout
- **Skills** — searchable, categorized view of installed SKILL.md files

Items rendered with a `soon` badge are intentional placeholders for v2.

## Known caveats (read before pitching to clients)

- **"Self-learning skills" is marketing, not code.** HERMÉS skills are static SKILL.md files agents consume; there is no auto-generation pipeline in the repo today. Pitch as *autonomous execution with curated skills.*
- **Agent spawn command is the fragile seam.** `hermes chat --non-interactive …` may need tuning per HERMÉS release. If subprocess args drift, edit `apps/bridge/hermes_client.py::start_agent`.
- **Single-tenant.** Bearer-token auth protects the bridge, but there's no per-user accounts or RBAC. Each client gets a dedicated deploy.
- **Per-agent task counts use a time-window heuristic.** A session counts toward an agent if it started during that agent's current uptime. Multi-agent overlap will misattribute. Real attribution requires HERMÉS to tag sessions with our agent_id (tracked as v2).

## Verification (smoke test)

1. `./installer/install.sh && ./installer/run.sh`
2. Open http://localhost:3737 → Agents page renders the seeded grid, no errors.
3. Overview page → counts populate; cost will be `$0.0000` until you've run anything.
4. Add Agent → fill in name + prompt → submit → new card appears.
5. Start the new agent → status dot turns green (or stale if it exits immediately; check Log).
6. Activity tab populates once HERMÉS writes its first session row to `state.db`.

## License

Staff Room OS code: MIT. Vendored HERMÉS Agent: MIT (Copyright (c) 2025 Nous Research). See `vendor/hermes-agent/LICENSE`.
