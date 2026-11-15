import json
from pathlib import Path
from typing import Dict, Any

SETTINGS_FILE = Path(__file__).parent / "data" / "settings.json"

DEFAULT_SETTINGS = {
    "port": 8181,
    "telegram": {
        "enabled": False,
        "bot_token": "",
        "chat_id": "",
        "socks_proxy": "",
        "api_server": ""
    }
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
        if "telegram" not in data or not isinstance(data["telegram"], dict):
            data["telegram"] = DEFAULT_SETTINGS["telegram"].copy()
        return data
    except Exception:
        return DEFAULT_SETTINGS.copy()


def save_settings(settings: Dict[str, Any]):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2, ensure_ascii=False), encoding="utf-8")
