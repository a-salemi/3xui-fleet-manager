import json
from pathlib import Path
from typing import Dict, Any

SETTINGS_FILE = Path(__file__).parent / "data" / "settings.json"

DEFAULT_SETTINGS = {
    "username": "admin",
    "password": "asdf1234!!@@",
    "port": 8181
}

def load_settings() -> Dict[str, Any]:
    if not SETTINGS_FILE.exists():
        save_settings(DEFAULT_SETTINGS)
        return DEFAULT_SETTINGS.copy()
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        for k, v in DEFAULT_SETTINGS.items():
            if k not in data:
                data[k] = v
        return data
    except Exception:
        return DEFAULT_SETTINGS.copy()

def save_settings(settings: Dict[str, Any]):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2, ensure_ascii=False), encoding="utf-8")
