"""Log endpoints: paginated read + live WebSocket tail."""
from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from watchfiles import awatch

from .. import hermes_client as hc

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("")
def list_logs() -> dict:
    return {
        "files": [
            {"name": p.name, "path": str(p), "size": p.stat().st_size}
            for p in hc.list_log_files()
        ]
    }


@router.get("/tail")
def tail(name: str = Query(...), lines: int = Query(200, ge=1, le=5000)) -> dict:
    for p in hc.list_log_files():
        if p.name == name:
            return {"name": name, "lines": hc.tail_log(p, lines=lines)}
    raise HTTPException(404, "Log file not found")


@router.websocket("/stream")
async def stream(ws: WebSocket, name: str) -> None:
    await ws.accept()
    target: Path | None = next((p for p in hc.list_log_files() if p.name == name), None)
    if target is None:
        await ws.send_json({"error": "not_found"})
        await ws.close()
        return

    # Send the existing tail first so the client has context.
    for line in hc.tail_log(target, lines=100):
        await ws.send_json({"line": line})

    pos = target.stat().st_size
    try:
        async for _ in awatch(target.parent, stop_event=None):
            if not target.exists():
                continue
            size = target.stat().st_size
            if size < pos:
                pos = 0  # truncated/rotated
            if size > pos:
                with target.open("r", errors="replace") as f:
                    f.seek(pos)
                    chunk = f.read()
                    pos = f.tell()
                for line in chunk.splitlines():
                    await ws.send_json({"line": line})
            await asyncio.sleep(0)
    except WebSocketDisconnect:
        return
    except Exception as exc:  # pragma: no cover - best-effort error surfacing
        await ws.send_json({"error": str(exc)})
        await ws.close()
