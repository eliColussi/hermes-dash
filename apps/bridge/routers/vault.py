"""Vault router: manage encrypted secrets."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth, vault as v

router = APIRouter(
    prefix="/api/vault",
    tags=["vault"],
    dependencies=[Depends(auth.require_token)],
)


class SecretPayload(BaseModel):
    key: str
    value: str


def _mask(s: str) -> str:
    if not s:
        return ""
    if len(s) <= 8:
        return "•" * len(s)
    return s[:4] + "•" * (len(s) - 8) + s[-4:]


@router.get("")
def list_secrets() -> dict:
    entries = v.load_all()
    return {
        "configured": v.is_configured(),
        "key_source": v.key_source(),
        "items": [{"key": k, "value_masked": _mask(val)} for k, val in entries.items()],
        "count": len(entries),
    }


@router.put("")
def set_secret(payload: SecretPayload) -> dict:
    if not payload.key.strip():
        raise HTTPException(400, "Key required")
    v.set_secret(payload.key.strip(), payload.value)
    return {"ok": True, "key": payload.key.strip()}


@router.delete("/{key}", status_code=204)
def delete_secret(key: str) -> None:
    if not v.delete_secret(key):
        raise HTTPException(404, "Secret not found")
