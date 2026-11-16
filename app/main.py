import uuid
import logging
import asyncio
from contextlib import asynccontextmanager
from typing import Dict, Any
from fastapi import FastAPI, Request, HTTPException, Depends, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app import storage, scheduler as sched, users
from app.config import load_settings, save_settings
from app.system import get_system_metrics
from app.telegram import test_telegram_alert
from app.models import (
    PanelConfigCreate, ScheduleEntryCreate, ScheduleEntryUpdate,
    PanelConfig, ScheduleEntry, GeneralSettingsUpdate,
    TelegramTestRequest, UserCreate, UserUpdate
)
from app.xui_client import XUIClient

# Maps session_token -> user_dict {"id": ..., "username": ..., "role": ...}
_sessions: Dict[str, Dict[str, Any]] = {}
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    sched.scheduler.start()
    asyncio.create_task(sched.reload_all_schedules_async())
    logger.info("Scheduler and auto-sync started.")
    yield
    sched.scheduler.shutdown(wait=False)


app = FastAPI(title="3X-UI Inbound Manager", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")


# ─── Auth Dependencies ────────────────────────────────────────────────────────

def get_current_user(request: Request) -> Dict[str, Any]:
    token = request.cookies.get("session")
    if not token or token not in _sessions:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return _sessions[token]


def require_operator_or_admin(user: Dict[str, Any] = Depends(get_current_user)):
    if user.get("role") not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="Forbidden: Operator or Admin role required.")
    return user


def require_admin(user: Dict[str, Any] = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: Administrator access required.")
    return user


# ─── HTML Pages ───────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    token = request.cookies.get("session")
    if token and token in _sessions:
        return RedirectResponse("/dashboard")
    return RedirectResponse("/login")


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})


@app.post("/login")
async def do_login(request: Request, username: str = Form(...), password: str = Form(...)):
    user = users.authenticate(username, password)
    if user:
        token = str(uuid.uuid4())
        _sessions[token] = user
        response = RedirectResponse("/dashboard", status_code=302)
        response.set_cookie("session", token, httponly=True, samesite="lax", max_age=86400 * 7)
        return response
    return templates.TemplateResponse("login.html", {"request": request, "error": "Invalid username or password"})


@app.get("/logout")
async def logout(request: Request):
    token = request.cookies.get("session")
    if token and token in _sessions:
        del _sessions[token]
    response = RedirectResponse("/login", status_code=302)
    response.delete_cookie("session")
    return response


@app.get("/dashboard", response_class=HTMLResponse)
@app.get("/schedules", response_class=HTMLResponse)
@app.get("/panels", response_class=HTMLResponse)
@app.get("/logs", response_class=HTMLResponse)
@app.get("/settings", response_class=HTMLResponse)
async def spa_page(request: Request):
    token = request.cookies.get("session")
    if not token or token not in _sessions:
        return RedirectResponse("/login")
    return templates.TemplateResponse("dashboard.html", {"request": request})


# ─── API: System Metrics & Monitoring ─────────────────────────────────────────

@app.get("/api/system/stats")
async def api_system_stats(_=Depends(get_current_user)):
    return get_system_metrics()


# ─── API: Current User (Me) ───────────────────────────────────────────────────

@app.get("/api/me")
async def api_me(user: Dict[str, Any] = Depends(get_current_user)):
    return user


# ─── API: User Management (Admin Only) ────────────────────────────────────────

@app.get("/api/users")
async def api_list_users(_=Depends(require_admin)):
    return users.get_users(safe=True)


@app.post("/api/users")
async def api_create_user(data: UserCreate, _=Depends(require_admin)):
    try:
        new_u = users.create_user(data.username, data.password, data.role)
        return new_u
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/users/{user_id}")
async def api_update_user(user_id: str, data: UserUpdate, _=Depends(require_admin)):
    try:
        updated = users.update_user(user_id, password=data.password, role=data.role)
        return updated
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/users/{user_id}")
async def api_delete_user(user_id: str, current_user: Dict[str, Any] = Depends(require_admin)):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own active account")
    try:
        if not users.delete_user(user_id):
            raise HTTPException(status_code=404, detail="User not found")
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── API: Panels ──────────────────────────────────────────────────────────────

@app.get("/api/panels")
async def api_list_panels(_=Depends(get_current_user)):
    return [p.model_dump() for p in storage.get_panels()]


@app.post("/api/panels")
async def api_add_panel(data: PanelConfigCreate, _=Depends(require_operator_or_admin)):
    panel = PanelConfig(id=str(uuid.uuid4()), **data.model_dump())
    storage.save_panel(panel)
    storage.add_log(panel.name, "All Inbounds", "CONFIG", "SUCCESS", f"Panel {panel.name} configured ({panel.url})")
    return panel.model_dump()


@app.delete("/api/panels/{panel_id}")
async def api_delete_panel(panel_id: str, _=Depends(require_admin)):
    p = storage.get_panel(panel_id)
    panel_name = p.name if p else panel_id
    if not storage.delete_panel(panel_id):
        raise HTTPException(404, "Panel not found")
    storage.add_log(panel_name, "All Inbounds", "DELETE", "SUCCESS", f"Panel {panel_name} and linked schedules removed")
    return {"ok": True}


@app.get("/api/panels/{panel_id}/inbounds")
async def api_get_inbounds(panel_id: str, _=Depends(get_current_user)):
    panel = storage.get_panel(panel_id)
    if not panel:
        raise HTTPException(404, "Panel not found")
    client = XUIClient(panel.url, panel.token, panel.path_prefix)
    try:
        inbounds = await client.get_inbounds()
        return [
            {
                "id": i["id"],
                "remark": i.get("remark", f"Inbound {i['id']}"),
                "enable": i.get("enable", True),
                "port": i.get("port")
            }
            for i in inbounds
        ]
    except Exception as e:
        storage.add_log(panel.name, "Inbounds Query", "TEST", "FAILED", str(e))
        raise HTTPException(502, detail=str(e))


# ─── API: Schedules ───────────────────────────────────────────────────────────

@app.get("/api/schedules")
async def api_list_schedules(_=Depends(get_current_user)):
    return [s.model_dump() for s in storage.get_schedules()]


@app.post("/api/schedules")
async def api_add_schedule(data: ScheduleEntryCreate, _=Depends(require_operator_or_admin)):
    data_dict = data.model_dump()
    if not data_dict.get("panel_name"):
        p = storage.get_panel(data.panel_id)
        if p:
            data_dict["panel_name"] = p.name
        else:
            panels = storage.get_panels()
            for p_item in panels:
                if str(p_item.id).strip() == str(data.panel_id).strip():
                    data_dict["panel_name"] = p_item.name
                    break
            if not data_dict.get("panel_name") and len(panels) == 1:
                data_dict["panel_name"] = panels[0].name

    schedule = ScheduleEntry(id=str(uuid.uuid4()), enabled=True, **data_dict)
    storage.save_schedule(schedule)
    sched.register_schedule(schedule.id)
    # Immediately check window and sync inbound state
    asyncio.create_task(sched.sync_schedule_state(schedule.id))
    return schedule.model_dump()


@app.put("/api/schedules/{schedule_id}")
async def api_update_schedule(schedule_id: str, data: ScheduleEntryUpdate, _=Depends(require_operator_or_admin)):
    schedule = storage.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")

    updated_data = schedule.model_dump()
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            updated_data[field] = value

    if not updated_data.get("panel_name") or ("panel_id" in data.model_dump(exclude_unset=True)):
        p = storage.get_panel(updated_data.get("panel_id"))
        if p:
            updated_data["panel_name"] = p.name

    updated_schedule = ScheduleEntry(**updated_data)
    storage.save_schedule(updated_schedule)
    sched.register_schedule(updated_schedule.id)
    asyncio.create_task(sched.sync_schedule_state(updated_schedule.id))
    return updated_schedule.model_dump()


@app.patch("/api/schedules/{schedule_id}/toggle")
async def api_toggle_schedule(schedule_id: str, _=Depends(require_operator_or_admin)):
    schedule = storage.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    schedule.enabled = not schedule.enabled
    storage.save_schedule(schedule)
    if schedule.enabled:
        sched.register_schedule(schedule.id)
        asyncio.create_task(sched.sync_schedule_state(schedule.id))
    else:
        sched.unregister_schedule(schedule.id)
    return schedule.model_dump()


@app.delete("/api/schedules/{schedule_id}")
async def api_delete_schedule(schedule_id: str, _=Depends(require_operator_or_admin)):
    sched.unregister_schedule(schedule_id)
    storage.delete_schedule(schedule_id)
    return {"ok": True}


@app.post("/api/schedules/{schedule_id}/run/{action}")
async def api_run_now(schedule_id: str, action: str, _=Depends(require_operator_or_admin)):
    if action not in ("enable", "disable"):
        raise HTTPException(400, "Action must be enable or disable")
    await sched._run_action(schedule_id, action, is_sync=False)
    return {"ok": True}


# ─── API: Logs ────────────────────────────────────────────────────────────────

@app.get("/api/logs")
async def api_get_logs(_=Depends(get_current_user)):
    return storage.get_logs()


@app.delete("/api/logs")
async def api_clear_logs(_=Depends(require_operator_or_admin)):
    storage.clear_logs()
    return {"ok": True}


# ─── API: Settings & Telegram (Admin Only) ────────────────────────────────────

@app.get("/api/settings")
async def api_get_settings(_=Depends(require_admin)):
    conf = load_settings()
    return {
        "port": conf.get("port", 8181),
        "telegram": conf.get("telegram", {})
    }


@app.post("/api/settings")
async def api_update_settings(data: GeneralSettingsUpdate, _=Depends(require_admin)):
    conf = load_settings()
    conf["port"] = int(data.port)
    conf["telegram"] = data.telegram.model_dump()
    save_settings(conf)
    return {"ok": True, "message": "Settings updated successfully."}


@app.post("/api/telegram/test")
async def api_test_telegram(data: TelegramTestRequest, _=Depends(require_admin)):
    try:
        res = await test_telegram_alert(
            bot_token=data.bot_token,
            chat_id=data.chat_id,
            socks_proxy=data.socks_proxy or "",
            api_server=data.api_server or ""
        )
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok"}
