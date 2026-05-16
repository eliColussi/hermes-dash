# Staff Room OS — Product Requirements Document

**Status:** v1.1 feature-complete on Railway. See [Shipped log](#shipped-log) at the bottom.
**Audience:** Eli (founder), future engineers, future client demos.
**Last updated:** 2026-05-15 (after Ralph loop ship of v1.0 + v1.1)

---

## 1. Vision

A drop-in **AI staff room** for non-technical operators. A receptionist, ops manager, or founder logs into a clean dashboard, spins up an AI employee, connects it to the tools they already use (Gmail, Slack, Stripe, HubSpot, …), gives it a job, and watches it run 24/7. They never see a terminal.

Under the hood: **HERMÉS Agent** (Nous Research, MIT) does the autonomous work. **Composio** is the universal tool gateway. **OpenRouter** is the AI gateway. **Railway** is the host. Staff Room OS is the bridge that makes the whole thing usable.

### Who it's for

- Founders running 1–20 person companies who want AI employees, not AI chatbots.
- Eli's consulting clients — installed per client, customized per client, distributed by Eli.

### What success looks like

> A client's receptionist opens the dashboard at 9am Monday, clicks "Add Agent", picks "Inbox Triage" from a template, pastes a Gmail authorization, and by 9:05am the agent is reading and labelling incoming email. No code. No Composio docs. No HERMÉS terminal. Just done.

---

## 2. Architecture — Where We Are

```
┌──────────────────────┐    ┌───────────────────────┐    ┌──────────────────────────┐
│  Next.js 15          │    │  FastAPI bridge       │    │  HERMÉS runtime          │
│  Dashboard + auth    │ ─► │  Bearer token, proxy  │ ─► │  (vendored, MIT)         │
│  Port $PORT          │    │  Port 8787 internal   │    │  CLI + gateway + cron    │
└──────────────────────┘    └───────────────────────┘    └──────────────────────────┘
                                       │
                                       ▼
                          ┌───────────────────────────┐
                          │  /data persistent volume  │
                          │  - state.db (SQLite)      │
                          │  - kanban.db              │
                          │  - cron/jobs.json         │
                          │  - webhook_subs.json      │
                          │  - skills/                │
                          │  - .env (creds)           │
                          │  - hooks/ (lifecycle)     │
                          └───────────────────────────┘
                                       ▲
                                       │
                          ┌───────────────────────────┐
                          │  Composio · OpenRouter ·  │
                          │  Telegram · Slack · …     │
                          └───────────────────────────┘
```

**Single-container, single-tenant** per client. Both processes in one Railway service. Multi-tenant SaaS is explicitly v2.

### What's already wired (v0.1, live)

- Dashboard with sidebar matching mock: Welcome, Overview, Agents, Tasks, Activity, Log, Integrations, Skills, Settings
- Bearer-token auth, auto-minted, persisted under `/data/staffroom/token`
- OpenRouter as primary AI provider, 8 models in Add Agent picker
- Integrations page for Telegram/Slack/Discord/Anthropic/OpenAI/OpenRouter credentials
- Spawn/stop HERMÉS chat subprocesses per agent
- `hermes gateway` daemon lifecycle
- Live log polling
- Skill catalog (87 built-in)
- Railway-ready Dockerfile + healthcheck + volume contract

---

## 3. What HERMÉS Already Does (Don't Rebuild)

This was the big finding from architectural research. Two surprises:

### 3.1 Cron scheduling — **built-in, production-ready**
- `cron/jobs.py` / `cron/scheduler.py` — full cron-expression engine via `croniter`
- Persisted at `~/.hermes/cron/jobs.json` (atomic writes, schema-stable)
- Supports cron expressions, intervals, one-shots
- Crash-resilient: pre-advances `next_run_at` before running
- Per-job repeat counter, auto-deletion on repeat-limit
- Output saved to `~/.hermes/cron/output/{job_id}/{ts}.md` with 0600 perms

→ **Our job is just to expose this in a friendly UI.** No backend work.

### 3.2 Webhook ingestion — **built-in, HMAC-authed**
- `gateway/platforms/webhook.py` — aiohttp HTTP server, default port 8644
- `POST /webhooks/{route_name}` with HMAC-SHA256 signature validation
- Rate limit (30/min default), body cap (1MB), 1-hour idempotency cache
- Dynamic route subscription via `~/.hermes/webhook_subscriptions.json` (hot-reloaded)
- Incoming payload → agent run via Jinja-style prompt template, or `deliver_only=true`
- Response routes to platform (Slack/Telegram/GitHub comment/etc.) via configured target

→ **Our job: a "Webhooks" UI to register/manage routes, and proxy the Railway-public URL.**

### 3.3 Lifecycle hooks
- `gateway/hooks.py` — drop a `~/.hermes/hooks/{name}/HOOK.yaml` + `handler.py`
- Events: `gateway:startup`, `session:start`, `session:end`, `agent:start`, `agent:step`, `agent:end`, `command:*`
- → **Our job: ship a "staffroom-audit-hook" handler that pipes every event to our audit log + dashboard Activity feed.**

### 3.4 MCP messaging bridge
- `mcp_serve.py` — 10 tools exposing conversations / messages / events / send-message / permissions
- This is the **memory-bridge to Claude Code** the video described. We don't need to build it; we just need to document it and surface a "Connect to Claude Code" toggle.

### 3.5 Kanban queue
- `~/.hermes/kanban.db` SQLite, WAL mode, CAS-locked
- Status machine: triage → todo → ready → running → blocked → done → archived
- → **Our Tasks page already reads it; we just add insert + delegate UX.**

---

## 4. What HERMÉS Doesn't Do (We Must Add)

### 4.1 Tool authorization (the Approvals tab)
HERMÉS executes any registered tool unconditionally. No "this agent is allowed Gmail-read but not Gmail-send" model. Our Approvals tab currently has no backing.

**To add:** A bridge-side allow-list per agent in `agents.yaml`. The bridge runs a pre-tool-call hook (handler dropped into `~/.hermes/hooks/agent:step/`) that checks the agent's allow-list and, for `requires_approval: true` tools, pauses execution and shows the call in the Approvals tab until a human clicks Approve or Deny.

### 4.2 Per-channel agent routing
**One gateway = one agent.** If a client wants different agents on Telegram vs Slack vs different Telegram bots, we have two options:
- **A. Spawn N gateway processes**, one per channel, each with its own `HERMES_HOME` subdir + own config. The bridge orchestrates. Works today. Heavy.
- **B. Patch the gateway** to take a per-platform agent override at `_resolve_session_agent_runtime` (`gateway/run.py:1815`). Small diff, backward-compatible. Better.

→ Plan: ship **A** in v1.0 (works immediately), implement **B** in v1.2.

### 4.3 Encrypted secrets at rest
`~/.hermes/.env` is plaintext. Railway's volume is encrypted at the disk layer but anything that reads the file (any HERMÉS process, any leaked image) sees plain text. For enterprise pitches we encrypt entries with libsodium + a Railway-Variable-supplied key.

### 4.4 Per-action audit log
HERMÉS rotates logs (data loss). We need an append-only audit trail for SOC2/enterprise. Easiest path: a hook handler that appends signed JSON to `/data/staffroom/audit/{yyyy-mm-dd}.jsonl`.

### 4.5 Composio adapter
HERMÉS doesn't know about Composio. One file: `tools/composio_tool.py` registered in `toolsets.py`. The tool takes `(app, action, params)`, proxies to Composio's SDK, returns the result. Composio handles 250+ apps' auth via their OAuth, so the user clicks "Connect Gmail" once in the Composio dashboard and the agent has Gmail forever.

---

## 5. Feature Roadmap

Each phase is a shippable milestone. Phases are ordered by ROI for Eli's client pipeline.

### v1.0 — "Sellable to first paying client" ✅ DONE (except blocked items)

| # | Feature | Status |
|---|---|---|
| 1.0.1 | Composio integration (UI + agent-callable plugin tools) | ✅ shipped (commits 6ef820e + d97e9ee) |
| 1.0.2 | Telegram + Slack live agent channels — end-to-end test | ⏳ BLOCKED on bot tokens from Eli |
| 1.0.3 | Cron scheduling UI | ✅ shipped (b55560e) |
| 1.0.4 | Approvals tab MVP | ✅ shipped (de3ebf5) — visibility only; response interaction in v1.1+ |
| 1.0.5 | Audit log sidecar | ✅ shipped (21859e7) |
| 1.0.6 | Polished onboarding | ✅ shipped (a991b90) — auto-detecting 6-step checklist |
| 1.0.7 | Bug fixes from first live deploy | ⏳ no real-world bugs reported yet |

### v1.1 — "Messaging + memory-bridge" ✅ DONE

| # | Feature | Status |
|---|---|---|
| 1.1.1 | Webhooks tab | ✅ shipped (1f49f6a) — with Stripe / GitHub / form / monitoring templates |
| 1.1.2 | Memory bridge to Claude Code | ✅ shipped (798b6e2) — MCP config snippet in Settings |
| 1.1.3 | Per-agent task attribution (real) | ✅ shipped (71b0916) — via audit-log lookup |
| 1.1.4 | Settings backup | ✅ shipped (23d1e1b) — restore deferred |
| 1.1.5 | Encrypted secrets | ✅ shipped (3fa4c30 + 6488e7e) — vault + Integrations routes through it |

### v1.2 — "Enterprise gloss"

| # | Feature | Status |
|---|---|---|
| 1.2.1 | Per-channel agent overrides | ⏳ HERMÉS fork required — large |
| 1.2.2 | Workflows visual builder | ⏳ planned — large |
| 1.2.3 | Goals tab | ⏳ planned — medium |
| 1.2.4 | Analytics tab | ✅ shipped (053aded) — cost / tokens / sessions by day, model, source, agent |
| 1.2.5 | Knowledge tab (RAG) | ⏳ planned — large |

### v2.0 — "Multi-tenant SaaS" (someday)

- Per-client account isolation: separate HERMES_HOME, separate Railway service, central control plane
- Billing integration (Stripe metering on tool calls / model spend)
- Role-based access (operator, viewer, approver)
- Audit log export to S3 / Datadog
- White-label per client (logo, theme, custom URL)

Eli's stance: don't start v2 until v1.0 + v1.1 are running in 5+ paying client deploys.

---

## 6. Composio — Deeper Spec

This is the single most important integration. Worth a dedicated section.

### What Composio gives us

- One SDK + one API key → tools for Gmail, Calendar, Slack, HubSpot, Salesforce, Stripe, Notion, Linear, GitHub, and ~250 more
- Composio handles each app's OAuth (we never store user OAuth tokens; Composio does)
- Standardized JSON-schema tool calls so the LLM doesn't need to learn each app's API
- ~20,000 free tool calls per Composio plan (per Eli) → end-user clients pay $0 for tooling

### How we wire it (v1.0.1)

1. **Bridge** — add `apps/bridge/composio_client.py` thin wrapper around `composio.Composio()` reading `COMPOSIO_API_KEY` from `.env`.
2. **HERMÉS custom tool** — write `apps/bridge/hermes_extensions/composio_tool.py`, register it into a HERMÉS toolset called `composio`. The tool signature:
   ```python
   composio_action(
       app: str,            # e.g. "gmail", "slack", "stripe"
       action: str,         # e.g. "send_email", "list_messages"
       params: dict,        # action-specific
       on_behalf_of: str    # the connected Composio account ID for this client
   ) -> dict
   ```
3. **Integrations card** — new top card on Integrations page. Fields: `COMPOSIO_API_KEY`. Below that, a list of "Connected apps" pulled from Composio's `/connections` endpoint. Each row: app icon, account label, "Disconnect" button. "Add app" button opens Composio's hosted OAuth flow in a popup.
4. **Add Agent → app picker** — when creating an agent, multi-select from connected Composio apps. Saves into agent's allow-list (also drives the Approvals tab).
5. **Per-action approval flagging** — Composio actions tagged `mutating` (Composio exposes this metadata) auto-flag `requires_approval: true` unless the operator overrides on the agent's permissions page.

### Why this matters more than any other feature

Every other vendor in this space hand-builds Gmail / Slack / HubSpot tools. We don't. We ship one Composio adapter and inherit 250 apps instantly. That's the moat.

---

## 7. Security Posture (per research)

| Concern | HERMÉS today | Staff Room v1.0 | v1.1 | v2.0 |
|---|---|---|---|---|
| Secret storage | plaintext `.env` | plaintext on encrypted Railway volume | libsodium-encrypted entries | per-tenant KMS |
| Tool authorization | none | bridge-side allow-list + Approvals tab | + RBAC per operator | + tenant-scoped policies |
| Audit log | rotating text logs | append-only JSONL sidecar | + signed entries | + S3/Datadog export |
| Multi-tenant | none | single-tenant per Railway service | single-tenant | full isolation |
| Network surface | localhost-only (gateway / api / web servers) | + bearer-token auth on the bridge proxy | + per-route HMAC for webhooks | + mTLS option |
| Prompt injection | minimal (sanitize_context only) | none added | input validator on webhook payloads | model-level guardrails |
| Update strategy | schema auto-migrate (v11) | manual `git pull` + Railway redeploy | UI "Update HERMÉS" button with pre-backup | staged rollouts |

Honest: at v1.0 we're enterprise-curious, not enterprise-grade. By v1.1 we're a credible SMB+ pitch. v2.0 is when "enterprise" goes on the deck.

---

## 8. Cost Model — Why Clients Won't Care About AI Spend

| Component | Who pays | Approx cost |
|---|---|---|
| Railway hosting | Client | $5–20/mo per deploy |
| OpenRouter | Client | $5–50/mo on cheap models (Claude Haiku 4.5, GPT-5 mini, DeepSeek R1) for typical SMB load |
| Composio | Composio free tier | $0 up to 20k tool calls |
| Anthropic / OpenAI direct | (optional, only if bypassing OpenRouter) | client-funded |
| Staff Room license | TBD by Eli | ? |

The default model picker should favor cheap-but-capable: **DeepSeek R1**, **Claude Haiku 4.5**, **GPT-5 mini**, **Gemini 2.5 Flash**. Expose pricing per model in the Add Agent picker so the operator sees the tradeoff.

---

## 9. Open Questions for Eli

Things I need a decision on before I start v1.0:

1. **Composio plan** — confirm you're on a paid plan that gives the 20k free tool calls per *client deploy* (vs. shared across all your clients). If shared, we hit the wall fast.
2. **Channel-agent pairing** — for v1.0, is it acceptable that "1 Telegram bot = 1 agent"? Or do you need "different agents on the same bot, picked by command or by user"? The latter requires the gateway patch from §4.2.
3. **Approvals workflow** — when an agent is blocked waiting for approval, where does the human get notified? Just the dashboard, or also a Slack/Telegram DM to the operator?
4. **Webhook URL exposure** — the Railway public URL is what receives webhooks. Are we okay surfacing `https://{client}.up.railway.app/webhooks/{route}` directly, or do we want a Staff-Room-controlled domain in front (e.g. `webhook.staffroom.os/{client}/{route}`)?
5. **First client deploy** — pick a real one. Real usage exposes bugs the smoke test won't. Even a friendly internal pilot.
6. **Naming** — "Staff Room OS" vs. "hermes-dash" — what's the brand? The dashboard repo is `hermes-dash`, the product is `Staff Room OS`. Worth pinning down before marketing exists.
7. **The video** — I can't watch `videoplayback.mp4`. Either share a transcript, or summarize the memory-bridge pattern verbally so I can map it to HERMÉS's `mcp_serve.py` correctly.

---

## 10. Immediate Next Actions

Once you ✅ this PRD, in order:

1. Build the Composio integration (PR target: v1.0.1)
2. Real Telegram bot test — you give me a bot token, I wire it end-to-end, we fix bugs (v1.0.2)
3. Build the Schedules UI on top of HERMÉS cron (v1.0.3)
4. Approvals tab MVP (v1.0.4)
5. Audit log sidecar (v1.0.5)
6. Onboarding wizard (v1.0.6)
7. Ship to one real client. Watch it break. Fix what breaks.

I'll commit this PRD to the repo so it's versioned and we can revise it as we ship.

---

## Shipped log

Ralph loop autonomous build, ordered by commit:

| # | Commit | PRD | Title |
|---|---|---|---|
| 1 | `6ef820e` | §1.0.1 | Composio management UI |
| 2 | `d97e9ee` | §1.0.1 | Composio plugin (3 agent-callable tools) |
| 3 | `b55560e` | §1.0.3 | Schedules tab + HERMÉS cron wrap |
| 4 | `1f49f6a` | §1.1.1 | Webhooks tab + /wh proxy + 4 templates |
| 5 | `21859e7` | §1.0.5 | staffroom-audit plugin + Activity audit feed |
| 6 | `de3ebf5` | §1.0.4 | Approvals tab (visibility MVP) |
| 7 | `798b6e2` | §1.1.2 | Claude Code MCP config snippet |
| 8 | `71b0916` | §1.1.3 | Real per-agent task attribution |
| 9 | `053aded` | §1.2.4 | Analytics tab |
| 10 | `23d1e1b` | §1.1.4 | Settings: backup download |
| 11 | `a991b90` | §1.0.6 | Onboarding wizard (auto-detecting) |
| 12 | (validation) | — | Full Docker build + container smoke test (all 13 pages 200, all endpoints 200, both plugins linked + enabled) |
| 13 | `3fa4c30` | §1.1.5 | Encrypted secrets vault (libsodium) |
| 14 | `6488e7e` | §1.1.5 | Integrations writes routed through vault |
| 15 | (this) | docs | PRD + README updated to reflect shipped state |

Outstanding for v1.0 ship:
- **§1.0.2 Telegram + Slack live channel test** — blocked on bot tokens from Eli. Once provided: ~30 min smoke test, fix any spawn-flag issues, demo-ready.

Outstanding for v1.2 (planning):
- §1.2.1 per-channel agent overrides (needs HERMÉS fork)
- §1.2.2 Workflows visual builder (large)
- §1.2.3 Goals tab (medium)
- §1.2.5 Knowledge / RAG (large)

