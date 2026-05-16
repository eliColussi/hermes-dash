"""Encrypted secrets vault for Staff Room OS.

Backed by libsodium secretbox (XSalsa20-Poly1305). Key derivation:

  1. $STAFFROOM_SECRETS_KEY (urlsafe-base64 of 32 random bytes) — preferred
     for Railway: paste into Variables, key never lives on the data volume
  2. $STAFFROOM_HOME/secrets.key — auto-generated 0600 file as a fallback
     for local development. Same volume as the vault is "encryption at rest"
     in the same sense as encrypted-disk SQLite: useful against backup
     theft, not against a host compromise.

The vault file is $STAFFROOM_HOME/vault.enc and stores an encrypted JSON
dict of {key: value, ...}. On bridge boot, the decrypted entries are
exported to os.environ so spawned subprocesses (the HERMÉS gateway, agent
runs, the kanban dispatcher) inherit them — no plaintext on disk.

This is the v1 boundary. Migrating existing plain `.env` entries into the
vault and deprecating .env-writes from the Integrations UI is the next
iteration.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import secrets as _secrets
import stat
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

VAULT_FILENAME = "vault.enc"
KEY_FILENAME = "secrets.key"


def _vault_path() -> Path:
    from .config import STAFFROOM_HOME
    return STAFFROOM_HOME / VAULT_FILENAME


def _key_file() -> Path:
    from .config import STAFFROOM_HOME
    return STAFFROOM_HOME / KEY_FILENAME


def _load_or_create_key() -> bytes:
    """Return the 32-byte secretbox key. Generate one if neither source has it."""
    env_key = os.environ.get("STAFFROOM_SECRETS_KEY")
    if env_key:
        try:
            return base64.urlsafe_b64decode(env_key + "==")[:32].ljust(32, b"\0")
        except Exception:
            logger.warning("STAFFROOM_SECRETS_KEY is not valid urlsafe-base64; ignoring")

    kf = _key_file()
    if kf.exists():
        try:
            return base64.urlsafe_b64decode(kf.read_text().strip() + "==")[:32].ljust(32, b"\0")
        except Exception:
            logger.warning("secrets.key is corrupt; regenerating")

    raw = _secrets.token_bytes(32)
    kf.parent.mkdir(parents=True, exist_ok=True)
    kf.write_text(base64.urlsafe_b64encode(raw).decode("ascii").rstrip("="))
    try:
        os.chmod(kf, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    return raw


def is_configured() -> bool:
    return _vault_path().exists() or _key_file().exists() or bool(
        os.environ.get("STAFFROOM_SECRETS_KEY")
    )


def key_source() -> str:
    if os.environ.get("STAFFROOM_SECRETS_KEY"):
        return "env"
    if _key_file().exists():
        return "file"
    return "generated"


# ---------------------------------------------------------------------------
# Read/write
# ---------------------------------------------------------------------------

def _box():
    from nacl.secret import SecretBox
    return SecretBox(_load_or_create_key())


def load_all() -> Dict[str, str]:
    path = _vault_path()
    if not path.exists():
        return {}
    try:
        ciphertext = path.read_bytes()
        plaintext = _box().decrypt(ciphertext)
        data = json.loads(plaintext.decode("utf-8"))
        return {str(k): str(v) for k, v in data.items()}
    except Exception as exc:
        logger.error("vault load failed: %s", exc)
        return {}


def save_all(entries: Dict[str, str]) -> None:
    path = _vault_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    plaintext = json.dumps(entries, ensure_ascii=False).encode("utf-8")
    ciphertext = _box().encrypt(plaintext)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(ciphertext)
    try:
        os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    os.replace(tmp, path)


def set_secret(key: str, value: str) -> None:
    entries = load_all()
    entries[key] = value
    save_all(entries)
    os.environ[key] = value  # take effect immediately for this process


def delete_secret(key: str) -> bool:
    entries = load_all()
    if key not in entries:
        return False
    del entries[key]
    save_all(entries)
    os.environ.pop(key, None)
    return True


def export_to_env() -> int:
    """Decrypt the vault and populate os.environ. Call at bridge boot.

    Existing env vars take precedence — the vault never overwrites an
    explicitly-set Railway Variable. Returns the number of new vars set.
    """
    n = 0
    for k, v in load_all().items():
        if k not in os.environ:
            os.environ[k] = v
            n += 1
    return n
