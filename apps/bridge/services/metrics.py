"""Business metrics pulled through Composio for the Home screen.

One number per connected app, chosen so a non-technical owner sees what is
going on without opening the app. Every spec is best-effort: a failed or
slow call yields a tile with value=None and a short hint, never an exception.
Results are cached for 60 seconds so a page refresh does not hammer Composio.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from .. import composio_link as cc

TTL_SEC = 60
PER_CALL_TIMEOUT = 10.0

# Apps we suggest connecting first, in the order they appear as "Connect" tiles.
SUGGESTED = [
    ("gmail", "Gmail", "📧"),
    ("googlecalendar", "Google Calendar", "📅"),
    ("hubspot", "HubSpot", "🟠"),
    ("stripe", "Stripe", "💳"),
    ("shopify", "Shopify", "🛍️"),
    ("quickbooks", "QuickBooks", "📒"),
    ("slack", "Slack", "💬"),
    ("pipedrive", "Pipedrive", "🟢"),
    ("calendly", "Calendly", "🗓️"),
    ("notion", "Notion", "📝"),
]
LABELS = {slug: (name, icon) for slug, name, icon in SUGGESTED}


def _iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


def _now() -> datetime:
    return datetime.now(timezone.utc).astimezone()


def _first_list(data: Any, keys: tuple[str, ...]) -> list:
    """Find the first list under any of `keys`, searching one level of nesting."""
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    for k in keys:
        v = data.get(k)
        if isinstance(v, list):
            return v
        if isinstance(v, dict):
            inner = _first_list(v, keys)
            if inner:
                return inner
    for v in data.values():
        if isinstance(v, dict):
            inner = _first_list(v, keys)
            if inner:
                return inner
    return []


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# --- extractors: (data) -> (value_str, hint) -------------------------------
def _count(keys: tuple[str, ...], noun: str) -> Callable[[Any], tuple[str, str]]:
    def fn(data: Any) -> tuple[str, str]:
        if isinstance(data, dict):
            for k in ("total", "count", "resultSizeEstimate", "total_count"):
                if isinstance(data.get(k), (int, float)):
                    return str(int(data[k])), noun
        items = _first_list(data, keys)
        return str(len(items)), noun
    return fn


def _stripe_revenue(data: Any) -> tuple[str, str]:
    charges = _first_list(data, ("data", "charges", "items"))
    total = 0.0
    currency = ""
    for ch in charges:
        if not isinstance(ch, dict):
            continue
        if ch.get("paid") and not ch.get("refunded"):
            total += _num(ch.get("amount")) - _num(ch.get("amount_refunded"))
            currency = currency or str(ch.get("currency", "")).upper()
    return f"{currency} {total / 100:,.0f}".strip(), f"across {len(charges)} charges, last 30 days"


def _quickbooks_unpaid(data: Any) -> tuple[str, str]:
    invoices = _first_list(data, ("Invoice", "invoices", "QueryResponse", "data"))
    open_inv = [i for i in invoices if isinstance(i, dict) and _num(i.get("Balance")) > 0]
    total = sum(_num(i.get("Balance")) for i in open_inv)
    return f"{total:,.0f}", f"{len(open_inv)} unpaid invoices"


def _pipedrive_summary(data: Any) -> tuple[str, str]:
    d = data.get("data", data) if isinstance(data, dict) else {}
    count = d.get("total_count") if isinstance(d, dict) else None
    value = None
    if isinstance(d, dict):
        tv = d.get("total_currency_converted_value") or d.get("total_value")
        value = tv
    if count is None and isinstance(d, dict):
        count = len(_first_list(d, ("items", "deals")))
    hint = f"worth {_num(value):,.0f}" if value else "open deals"
    return str(count or 0), hint


SPECS: dict[str, dict[str, Any]] = {
    "gmail": {
        "label": "Unread emails",
        "action": "GMAIL_FETCH_EMAILS",
        "args": lambda: {"query": "is:unread", "max_results": 50, "ids_only": True},
        "extract": _count(("messages", "items"), "waiting in the inbox"),
    },
    "googlecalendar": {
        "label": "Meetings today",
        "action": "GOOGLECALENDAR_FIND_EVENT",
        "args": lambda: {
            "time_min": _iso(_now().replace(hour=0, minute=0, second=0)),
            "time_max": _iso((_now() + timedelta(days=1)).replace(hour=0, minute=0, second=0)),
            "max_results": 50,
        },
        "extract": _count(("items", "events"), "on the calendar today"),
    },
    "hubspot": {
        "label": "Open deals",
        "action": "HUBSPOT_SEARCH_DEALS",
        "args": lambda: {
            "limit": 100,
            "filterGroups": [{"filters": [{"propertyName": "hs_is_closed", "operator": "EQ", "value": "false"}]}],
        },
        "extract": _count(("results", "items"), "in the pipeline"),
    },
    "stripe": {
        "label": "Revenue, 30 days",
        "action": "STRIPE_LIST_CHARGES",
        "args": lambda: {"limit": 100, "created": {"gte": int((_now() - timedelta(days=30)).timestamp())}},
        "extract": _stripe_revenue,
    },
    "shopify": {
        "label": "Orders, 30 days",
        "action": "SHOPIFY_RETRIEVES_AN_ORDER_COUNT",
        "args": lambda: {"status": "any", "created_at_min": _iso(_now() - timedelta(days=30))},
        "extract": _count(("orders", "items"), "placed in the last 30 days"),
    },
    "quickbooks": {
        "label": "Unpaid invoices",
        "action": "QUICKBOOKS_QUERY_INVOICES",
        "args": lambda: {"max_results": 100},
        "extract": _quickbooks_unpaid,
    },
    "slack": {
        "label": "Active channels",
        "action": "SLACK_LIST_ALL_CHANNELS",
        "args": lambda: {"limit": 200, "exclude_archived": True},
        "extract": _count(("channels", "items"), "your team talks in"),
    },
    "pipedrive": {
        "label": "Open deals",
        "action": "PIPEDRIVE_GET_DEALS_SUMMARY",
        "args": lambda: {"status": "open"},
        "extract": _pipedrive_summary,
    },
    "calendly": {
        "label": "Upcoming bookings",
        "action": "CALENDLY_LIST_SCHEDULED_EVENTS",
        "args": lambda: {"status": "active", "count": 100},
        "extract": _count(("collection", "items"), "booked through Calendly"),
    },
    "notion": {
        "label": "Notion",
        "action": None,
        "args": lambda: {},
        "extract": lambda d: ("Connected", "ask an agent to read or write pages"),
    },
}

_cache: dict[str, tuple[float, dict]] = {}


def _execute(client, action: str, args: dict) -> Any:
    result = client.tools.execute(slug=action, arguments=args, user_id=cc.STAFFROOM_USER_ID)
    if isinstance(result, dict):
        ok, data, err = result.get("successful"), result.get("data"), result.get("error")
    else:
        ok, data, err = getattr(result, "successful", None), getattr(result, "data", None), getattr(result, "error", None)
    if ok is False:
        raise RuntimeError(str(err or "action failed")[:160])
    return data


def _tile(toolkit: str, client) -> dict:
    name, icon = LABELS.get(toolkit, (toolkit.title(), "🔌"))
    spec = SPECS.get(toolkit)
    base = {"toolkit": toolkit, "name": name, "icon": icon, "connected": True, "fetched_at": time.time()}
    if not spec:
        return {**base, "label": name, "value": "Connected", "hint": "ask an agent to use it", "status": "ok"}
    if not spec["action"]:
        value, hint = spec["extract"]({})
        return {**base, "label": spec["label"], "value": value, "hint": hint, "status": "ok"}
    try:
        data = _execute(client, spec["action"], spec["args"]())
        value, hint = spec["extract"](data)
        return {**base, "label": spec["label"], "value": value, "hint": hint, "status": "ok"}
    except Exception as exc:  # noqa: BLE001
        return {
            **base,
            "label": spec["label"],
            "value": None,
            "hint": f"Couldn't read {name}: {type(exc).__name__}: {str(exc)[:80]}",
            "status": "error",
        }


def collect(connected: list[str], refresh: bool = False) -> list[dict]:
    """One tile per connected toolkit, in parallel, cached 60s. Order = SUGGESTED order first."""
    client = cc.get_client()
    now = time.time()
    order = [s for s, _, _ in SUGGESTED if s in connected] + [s for s in connected if s not in LABELS]
    todo = [s for s in order if refresh or s not in _cache or now - _cache[s][0] > TTL_SEC]
    if todo and client is not None:
        with ThreadPoolExecutor(max_workers=min(8, len(todo))) as pool:
            futs = {pool.submit(_tile, s, client): s for s in todo}
            done, pending = wait(futs, timeout=PER_CALL_TIMEOUT + 2)
            for f in done:
                _cache[futs[f]] = (now, f.result())
            for f in pending:
                s = futs[f]
                name, icon = LABELS.get(s, (s.title(), "🔌"))
                _cache[s] = (now, {"toolkit": s, "name": name, "icon": icon, "connected": True, "label": SPECS.get(s, {}).get("label", name),
                                   "value": None, "hint": f"{name} is slow to answer right now", "status": "error", "fetched_at": now})
    out = []
    for s in order:
        if s in _cache:
            out.append(_cache[s][1])
    return out


def suggestions(connected: list[str], limit: int = 6) -> list[dict]:
    return [
        {"toolkit": s, "name": n, "icon": i, "connected": False, "label": n, "value": None, "hint": "", "status": "connect"}
        for s, n, i in SUGGESTED if s not in connected
    ][:limit]
