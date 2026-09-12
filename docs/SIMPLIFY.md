# Simplify: the algorithm applied to Staff Room OS

Musk's five steps, in order: question every requirement, delete the part, simplify and optimize what is left, accelerate, automate last. The order is the point. Optimizing a page that should not exist is the classic mistake.

Applied 2026-09-12 to the dashboard a lead receives.

## 1. Question the requirements

Who uses this: a business owner or their office manager, not an operator. What they need:

- see what is going on in the apps they already use, without opening them
- tell an AI employee to do something, and read what it did
- connect an app in one click

What they do not need: a kanban, a log tail, cron syntax, webhook templates, an approvals ledger, a cost analytics page, a skills catalog, a goals board. Those are our tools for running the runtime, not theirs for running their business.

## 2. Delete

Sidebar before: Home, Agents, Chat, Schedules, Triggers, Activity, Approvals, Goals, Connections, Usage, Settings. Plus a search box that searched nothing.

Sidebar after: Home, Apps, Agents. Settings stays at the bottom.

Nothing was deleted from the codebase. Every page still answers at its URL (`/chat`, `/schedules`, `/webhooks`, `/activity`, `/approvals`, `/goals`, `/analytics`, `/skills`, `/tasks`, `/log`, `/welcome`). They are off the menu. If a client asks for one of them twice, put it back. If nobody asks in a month, delete the code.

## 3. Simplify

One screen, `/home`, three blocks top to bottom:

1. **Your numbers.** One tile per connected app with one figure: unread emails, meetings today, open deals, revenue last 30 days, orders, unpaid invoices. Apps not yet connected show as a Connect tile. Data comes through Composio (`apps/bridge/services/metrics.py`), one action per app, cached 60 seconds, every call best-effort so a slow app never blocks the page.
2. **Tell your team.** Agent chips, one text box, Send. Reuses the existing chat threads under the hood; the reply appears inline.
3. **What happened.** The last eight runs, in plain words.

If a model key or Composio key is missing, one strip at the top says so and links to Apps. The five-step onboarding checklist is gone from the menu (still at `/welcome`).

## 4. Accelerate

The page is one request: `GET /api/home` returns setup state, connections, metrics, agents and recent runs together. Metric calls run in parallel with a 10 second ceiling.

## 5. Automate

Numbers refresh every 60 seconds on their own. Connect is Composio's managed OAuth, one popup. Nothing else on this screen needs automating yet, which is the right amount.

## Adding a metric

One entry in `SPECS` in `apps/bridge/services/metrics.py`: the Composio action slug, its arguments, and a function that turns the response into a value and a hint. Test with a connected account before shipping; the extractors are written from the action schemas, not from live responses, for HubSpot, Stripe, Shopify, QuickBooks, Pipedrive and Calendly.
