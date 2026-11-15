import json
import uuid
import os
from pathlib import Path
from typing import List, Optional, Dict
from app.models import PanelConfig, ScheduleEntry

DATA_DIR = Path(__file__).parent / "data"
PANELS_FILE = DATA_DIR / "panels.json"
SCHEDULES_FILE = DATA_DIR / "schedules.json"


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
    return [ScheduleEntry(**s) for s in _load_json(SCHEDULES_FILE)]


def get_schedule(schedule_id: str) -> Optional[ScheduleEntry]:
    for s in get_schedules():
        if s.id == schedule_id:
            return s
    return None


def save_schedule(schedule: ScheduleEntry):
    schedules = _load_json(SCHEDULES_FILE)
    for i, s in enumerate(schedules):
        if s["id"] == schedule.id:
            schedules[i] = schedule.model_dump()
            _save_json(SCHEDULES_FILE, schedules)
            return
    schedules.append(schedule.model_dump())
    _save_json(SCHEDULES_FILE, schedules)


def delete_schedule(schedule_id: str) -> bool:
    schedules = _load_json(SCHEDULES_FILE)
    target_id = str(schedule_id).strip()
    new = [s for s in schedules if str(s.get("id")).strip() != target_id]
    _save_json(SCHEDULES_FILE, new)
    return True
