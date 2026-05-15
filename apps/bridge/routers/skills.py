"""Skills enumeration."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import hermes_client as hc
from ..models import Skill

router = APIRouter(prefix="/api/skills", tags=["skills"])


@router.get("", response_model=list[Skill])
def list_skills() -> list[Skill]:
    return [Skill(**s) for s in hc.list_skills()]


@router.get("/{category}/{name}")
def get_skill(category: str, name: str) -> dict:
    skill = hc.read_skill(category, name)
    if skill is None:
        raise HTTPException(404, "Skill not found")
    return skill
