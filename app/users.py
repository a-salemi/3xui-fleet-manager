import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any

USERS_FILE = Path(__file__).parent / "data" / "users.json"

DEFAULT_USERS = [
    {
        "id": "root-admin",
        "username": "admin",
        "password": "asdf1234!!@@",
        "role": "admin",
        "created_at": "2026-01-01 00:00:00"
    }
]


def _load_users_raw() -> List[Dict[str, Any]]:
    if not USERS_FILE.exists():
        _save_users_raw(DEFAULT_USERS)
        return DEFAULT_USERS.copy()
    try:
        data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
        if not data:
            _save_users_raw(DEFAULT_USERS)
            return DEFAULT_USERS.copy()
        return data
    except Exception:
        return DEFAULT_USERS.copy()


def _save_users_raw(data: List[Dict[str, Any]]):
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def get_users(safe: bool = True) -> List[Dict[str, Any]]:
    users = _load_users_raw()
    if safe:
        return [
            {k: v for k, v in u.items() if k != "password"}
            for u in users
        ]
    return users


def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    for u in _load_users_raw():
        if u["id"] == user_id:
            return u
    return None


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    u_lower = username.strip().lower()
    for u in _load_users_raw():
        if u["username"].strip().lower() == u_lower:
            return u
    return None


def authenticate(username: str, password: str) -> Optional[Dict[str, Any]]:
    user = get_user_by_username(username)
    if user and user["password"] == password:
        return {k: v for k, v in user.items() if k != "password"}
    return None


def create_user(username: str, password: str, role: str = "operator") -> Dict[str, Any]:
    username = username.strip()
    if not username:
        raise ValueError("Username cannot be empty")
    if get_user_by_username(username):
        raise ValueError(f"Username '{username}' already exists")
    if not password or len(password) < 4:
        raise ValueError("Password must be at least 4 characters")
    if role not in ("admin", "operator", "viewer"):
        role = "operator"

    users = _load_users_raw()
    new_user = {
        "id": str(uuid.uuid4())[:8],
        "username": username,
        "password": password.strip(),
        "role": role,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    users.append(new_user)
    _save_users_raw(users)
    return {k: v for k, v in new_user.items() if k != "password"}


def update_user(user_id: str, password: Optional[str] = None, role: Optional[str] = None) -> Dict[str, Any]:
    users = _load_users_raw()
    found = False
    updated_user = None

    for i, u in enumerate(users):
        if u["id"] == user_id:
            if password and password.strip():
                u["password"] = password.strip()
            if role and role in ("admin", "operator", "viewer"):
                # Ensure we don't demote the last remaining admin
                if u["role"] == "admin" and role != "admin":
                    admin_count = sum(1 for x in users if x["role"] == "admin")
                    if admin_count <= 1:
                        raise ValueError("Cannot demote the only remaining administrator")
                u["role"] = role
            users[i] = u
            updated_user = u
            found = True
            break

    if not found:
        raise ValueError("User not found")

    _save_users_raw(users)
    return {k: v for k, v in updated_user.items() if k != "password"}


def delete_user(user_id: str) -> bool:
    users = _load_users_raw()
    target = None
    for u in users:
        if u["id"] == user_id:
            target = u
            break

    if not target:
        return False

    if target["role"] == "admin":
        admin_count = sum(1 for x in users if x["role"] == "admin")
        if admin_count <= 1:
            raise ValueError("Cannot delete the only remaining administrator")

    new_list = [u for u in users if u["id"] != user_id]
    _save_users_raw(new_list)
    return True
