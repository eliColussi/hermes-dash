"""Log endpoints: paginated read + live WebSocket tail."""
from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from watchfiles import awatch

from .. import auth, hermes_client as hc

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("", dependencies=[Depends(auth.require_token)])
def list_logs() -> dict:
    return {
        "files": [
            {"name": p.name, "path": str(p), "size": p.stat().st_size}
            for p in hc.list_log_files()
        ]
    }


@router.get("/tail", dependencies=[Depends(auth.require_token)])
def tail(name: str = Query(...), lines: int = Query(200, ge=1, le=5000)) -> dict:
    for p in hc.list_log_files():
        if p.name == name:
            return {"name": name, "lines": hc.tail_log(p, lines=lines)}
    raise HTTPException(404, "Log file not found")


@router.websocket("/stream")
async def stream(ws: WebSocket, name: str, token: str | None = None) -> None:
    if not auth.is_disabled():
        import secrets as _secrets
        if not token or not _secrets.compare_digest(token, auth.current_token()):
            await ws.close(code=4401)
            return
    await ws.accept()
    target: Path | None = next((p for p in hc.list_log_files() if p.name == name), None)
    if target is None:
        await ws.send_json({"error": "not_found"})
        await ws.close()
        return

    for line in hc.tail_log(target, lines=100):
        await ws.send_json({"line": line})

    pos = target.stat().st_size
    try:
        async for _ in awatch(target.parent, stop_event=None):
            if not target.exists():
                continue
            size = target.stat().st_size
            if size < pos:
                pos = 0
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
    except Exception as exc:  # pragma: no cover
        await ws.send_json({"error": str(exc)})
        await ws.close()
