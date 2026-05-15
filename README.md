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
- **Single-tenant only.** No auth, no multi-tenant isolation. Each client gets a dedicated install.
- **Tool-call count is a proxy for "tasks today."** Real per-agent task attribution requires a HERMÉS schema patch (add `staffroom_agent_id` column to `sessions`). Tracked as v2.

## Verification (smoke test)

1. `./installer/install.sh && ./installer/run.sh`
2. Open http://localhost:3737 → Agents page renders the seeded grid, no errors.
3. Overview page → counts populate; cost will be `$0.0000` until you've run anything.
4. Add Agent → fill in name + prompt → submit → new card appears.
5. Start the new agent → status dot turns green (or stale if it exits immediately; check Log).
6. Activity tab populates once HERMÉS writes its first session row to `state.db`.

## License

Staff Room OS code: MIT. Vendored HERMÉS Agent: MIT (Copyright (c) 2025 Nous Research). See `vendor/hermes-agent/LICENSE`.
