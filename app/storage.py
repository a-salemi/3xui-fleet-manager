import json
import uuid
import os
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any
from app.models import PanelConfig, ScheduleEntry

DATA_DIR = Path(__file__).parent / "data"
PANELS_FILE = DATA_DIR / "panels.json"
SCHEDULES_FILE = DATA_DIR / "schedules.json"
LOGS_FILE = DATA_DIR / "logs.json"


def _load_json(path: Path) -> list:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_json(path: Path, data: list):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


# ─── Panels ───────────────────────────────────────────────────────────────────

def get_panels() -> List[PanelConfig]:
    return [PanelConfig(**p) for p in _load_json(PANELS_FILE)]


def get_panel(panel_id: str) -> Optional[PanelConfig]:
    for p in get_panels():
        if p.id == panel_id:
            return p
    return None


def save_panel(panel: PanelConfig):
    panels = _load_json(PANELS_FILE)
    for i, p in enumerate(panels):
        if p["id"] == panel.id:
            panels[i] = panel.model_dump()
            _save_json(PANELS_FILE, panels)
            return
    panels.append(panel.model_dump())
    _save_json(PANELS_FILE, panels)


def delete_panel(panel_id: str) -> bool:
    panels = _load_json(PANELS_FILE)
    new = [p for p in panels if p["id"] != panel_id]
    if len(new) == len(panels):
        return False
    _save_json(PANELS_FILE, new)
    # also remove schedules for this panel
    schedules = _load_json(SCHEDULES_FILE)
    _save_json(SCHEDULES_FILE, [s for s in schedules if s["panel_id"] != panel_id])
    return True


# ─── Schedules ─────────────────────────────────────────────────────────────────

def get_schedules() -> List[ScheduleEntry]:
    raw = _load_json(SCHEDULES_FILE)
    panels = get_panels()
    panels_map = {str(p.id).strip(): p.name for p in panels}
    results = []
    for s in raw:
        p_id = str(s.get("panel_id", "")).strip()
        if not s.get("panel_name"):
            if p_id in panels_map:
                s["panel_name"] = panels_map[p_id]
            elif len(panels) == 1:
                s["panel_name"] = panels[0].name
        results.append(ScheduleEntry(**s))
    return results


def get_schedule(schedule_id: str) -> Optional[ScheduleEntry]:
    target_id = str(schedule_id).strip()
    for s in get_schedules():
        if str(s.id).strip() == target_id:
            return s
    return None


def save_schedule(schedule: ScheduleEntry):
    if not schedule.panel_name:
        p = get_panel(schedule.panel_id)
        if p:
            schedule.panel_name = p.name
        else:
            panels = get_panels()
            for p_item in panels:
                if str(p_item.id).strip() == str(schedule.panel_id).strip():
                    schedule.panel_name = p_item.name
                    break
            if not schedule.panel_name and len(panels) == 1:
                schedule.panel_name = panels[0].name

    schedules = _load_json(SCHEDULES_FILE)
    sched_dict = schedule.model_dump()
    target_id = str(schedule.id).strip()
    for i, s in enumerate(schedules):
        if str(s.get("id")).strip() == target_id:
            schedules[i] = sched_dict
            _save_json(SCHEDULES_FILE, schedules)
            return
    schedules.append(sched_dict)
    _save_json(SCHEDULES_FILE, schedules)


def delete_schedule(schedule_id: str) -> bool:
    schedules = _load_json(SCHEDULES_FILE)
    target_id = str(schedule_id).strip()
    new = [s for s in schedules if str(s.get("id")).strip() != target_id]
    _save_json(SCHEDULES_FILE, new)
    return True


# ─── Execution Logs (Persistent) ───────────────────────────────────────────────

def add_log(panel_name: str, inbound_remark: str, action: str, status: str, details: str):
    """
    Append an execution log entry and keep the last 300 entries.
    action: ENABLE | DISABLE | SYNC | TEST
    status: SUCCESS | FAILED | WARNING
    """
    logs = _load_json(LOGS_FILE)
    entry = {
        "id": str(uuid.uuid4())[:8],
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "panel": panel_name,
        "inbound": inbound_remark,
        "action": action.upper(),
        "status": status.upper(),
        "details": details
    }
    logs.insert(0, entry)
    if len(logs) > 300:
        logs = logs[:300]
    _save_json(LOGS_FILE, logs)
    return entry


def get_logs() -> List[Dict[str, Any]]:
    return _load_json(LOGS_FILE)


def clear_logs():
    _save_json(LOGS_FILE, [])
