import hmac
import hashlib
import time
import struct
import base64
import secrets
import urllib.parse
from typing import Optional, Dict, Any
from app.config import load_settings, save_settings


def generate_secret() -> str:
    """Generates a secure 32-character Base32 TOTP secret (160 bits entropy)."""
    raw = secrets.token_bytes(20)
    return base64.b32encode(raw).decode("utf-8").replace("=", "").strip().upper()


def get_provisioning_uri(secret: str, account_name: str = "Admin", issuer_name: str = "3X-UI Fleet Manager") -> str:
    """Generates the standard otpauth:// URI for authenticator apps."""
    clean_secret = secret.strip().upper().replace(" ", "")
    acc = urllib.parse.quote(account_name.strip())
    iss = urllib.parse.quote(issuer_name.strip())
    return f"otpauth://totp/{iss}:{acc}?secret={clean_secret}&issuer={iss}&algorithm=SHA1&digits=6&period=30"


def get_totp_code(secret: str, interval: int = 30, for_time: Optional[float] = None) -> str:
    """Calculates the current 6-digit TOTP code for a given secret."""
    if for_time is None:
        for_time = time.time()
    cleaned = secret.strip().upper().replace(" ", "")
    padding = len(cleaned) % 8
    if padding != 0:
        cleaned += "=" * (8 - padding)
    key = base64.b32decode(cleaned)
    counter = int(for_time // interval)
    msg = struct.pack(">Q", counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    offset = h[-1] & 0x0F
    code_int = struct.unpack(">I", h[offset:offset+4])[0] & 0x7FFFFFFF
    return f"{code_int % 1000000:06d}"


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    """Verifies a 6-digit TOTP code with time-drift window support."""
    if not secret or not code:
        return False
    clean_code = str(code).strip().replace(" ", "").replace("-", "")
    if len(clean_code) != 6 or not clean_code.isdigit():
        return False
    now = time.time()
    for step in range(-window, window + 1):
        target = get_totp_code(secret, interval=30, for_time=now + step * 30)
        if hmac.compare_digest(target, clean_code):
            return True
    return False


def is_2fa_enabled() -> bool:
    """Checks whether 2FA is currently active in settings."""
    cfg = load_settings().get("two_factor", {})
    return bool(cfg.get("enabled") and cfg.get("secret"))


def get_2fa_status() -> Dict[str, Any]:
    """Returns safe 2FA status for UI (without leaking secret)."""
    cfg = load_settings().get("two_factor", {})
    enabled = bool(cfg.get("enabled") and cfg.get("secret"))
    return {
        "enabled": enabled,
        "configured": bool(cfg.get("secret"))
    }


def enable_2fa(secret: str, verification_code: str) -> bool:
    """Verifies the initial code and saves the secret to settings."""
    if not verify_totp(secret, verification_code):
        return False
    settings = load_settings()
    settings["two_factor"] = {
        "enabled": True,
        "secret": secret.strip().upper().replace(" ", "")
    }
    save_settings(settings)
    return True


def disable_2fa() -> bool:
    """Disables 2FA and removes the secret."""
    settings = load_settings()
    settings["two_factor"] = {
        "enabled": False,
        "secret": ""
    }
    save_settings(settings)
    return True
