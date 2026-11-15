import uuid
import logging
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, Depends, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app import storage, scheduler as sched
from app.config import load_settings, save_settings
from app.models import (
    PanelConfigCreate, ScheduleEntryCreate, ScheduleEntryUpdate,
    PanelConfig, ScheduleEntry, SettingsUpdate
)
from app.xui_client import XUIClient

_sessions: set[str] = set()
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    sched.scheduler.start()
    # Asynchronously load and sync state without blocking startup
    asyncio.create_task(sched.reload_all_schedules_async())
    logger.info("Scheduler started and background sync initialized.")
    yield
    sched.scheduler.shutdown(wait=False)


app = FastAPI(title="3X-UI Inbound Manager", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")


def get_session_token(request: Request) -> str | None:
    return request.cookies.get("session")


def require_auth(request: Request):
    token = get_session_token(request)
    if not token or token not in _sessions:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return token


# ─── Auth & HTML Pages ────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    token = get_session_token(request)
    if token and token in _sessions:
        return RedirectResponse("/dashboard")
    return RedirectResponse("/login")


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})


@app.post("/login")
async def do_login(request: Request, username: str = Form(...), password: str = Form(...)):
    conf = load_settings()
    if username == conf.get("username") and password == conf.get("password"):
        token = str(uuid.uuid4())
        _sessions.add(token)
        response = RedirectResponse("/dashboard", status_code=302)
        response.set_cookie("session", token, httponly=True, samesite="lax", max_age=86400 * 7)
        return response
    return templates.TemplateResponse("login.html", {"request": request, "error": "Invalid credentials"})


@app.get("/logout")
async def logout(request: Request):
    token = get_session_token(request)
    if token:
        _sessions.discard(token)
    response = RedirectResponse("/login", status_code=302)
    response.delete_cookie("session")
    return response


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request):
    token = get_session_token(request)
    if not token or token not in _sessions:
        return RedirectResponse("/login")
    return templates.TemplateResponse("dashboard.html", {"request": request})


# ─── API: Panels ──────────────────────────────────────────────────────────────

@app.get("/api/panels")
async def api_list_panels(_=Depends(require_auth)):
    return [p.model_dump() for p in storage.get_panels()]


@app.post("/api/panels")
async def api_add_panel(data: PanelConfigCreate, _=Depends(require_auth)):
    panel = PanelConfig(id=str(uuid.uuid4()), **data.model_dump())
    storage.save_panel(panel)
    storage.add_log(panel.name, "All Inbounds", "CONFIG", "SUCCESS", f"Panel {panel.name} added ({panel.url})")
    return panel.model_dump()


@app.delete("/api/panels/{panel_id}")
async def api_delete_panel(panel_id: str, _=Depends(require_auth)):
    p = storage.get_panel(panel_id)
    panel_name = p.name if p else panel_id
    if not storage.delete_panel(panel_id):
        raise HTTPException(404, "Panel not found")
    storage.add_log(panel_name, "All Inbounds", "DELETE", "SUCCESS", f"Panel {panel_name} and related schedules deleted")
    return {"ok": True}


@app.get("/api/panels/{panel_id}/inbounds")
async def api_get_inbounds(panel_id: str, _=Depends(require_auth)):
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
async def api_list_schedules(_=Depends(require_auth)):
    return [s.model_dump() for s in storage.get_schedules()]


@app.post("/api/schedules")
async def api_add_schedule(data: ScheduleEntryCreate, _=Depends(require_auth)):
    schedule = ScheduleEntry(id=str(uuid.uuid4()), enabled=True, **data.model_dump())
    storage.save_schedule(schedule)
    sched.register_schedule(schedule.id)
    # Immediately evaluate current time and sync inbound state!
    asyncio.create_task(sched.sync_schedule_state(schedule.id))
    return schedule.model_dump()


@app.put("/api/schedules/{schedule_id}")
async def api_update_schedule(schedule_id: str, data: ScheduleEntryUpdate, _=Depends(require_auth)):
    schedule = storage.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")

    updated_data = schedule.model_dump()
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            updated_data[field] = value

    updated_schedule = ScheduleEntry(**updated_data)
    storage.save_schedule(updated_schedule)
    sched.register_schedule(updated_schedule.id)

    # Re-sync inbound state immediately with new schedule hours
    asyncio.create_task(sched.sync_schedule_state(updated_schedule.id))
    return updated_schedule.model_dump()


@app.patch("/api/schedules/{schedule_id}/toggle")
async def api_toggle_schedule(schedule_id: str, _=Depends(require_auth)):
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
async def api_delete_schedule(schedule_id: str, _=Depends(require_auth)):
    sched.unregister_schedule(schedule_id)
    storage.delete_schedule(schedule_id)
    return {"ok": True}


@app.post("/api/schedules/{schedule_id}/run/{action}")
async def api_run_now(schedule_id: str, action: str, _=Depends(require_auth)):
    if action not in ("enable", "disable"):
        raise HTTPException(400, "Action must be enable or disable")
    await sched._run_action(schedule_id, action, is_sync=False)
    return {"ok": True}


# ─── API: Logs & Stats ────────────────────────────────────────────────────────

@app.get("/api/logs")
async def api_get_logs(_=Depends(require_auth)):
    return storage.get_logs()


@app.delete("/api/logs")
async def api_clear_logs(_=Depends(require_auth)):
    storage.clear_logs()
    return {"ok": True}


# ─── API: Settings ────────────────────────────────────────────────────────────

@app.get("/api/settings")
async def api_get_settings(_=Depends(require_auth)):
    conf = load_settings()
    return {"username": conf.get("username", "admin"), "port": conf.get("port", 8181)}


@app.post("/api/settings")
async def api_update_settings(data: SettingsUpdate, _=Depends(require_auth)):
    conf = load_settings()
    conf["username"] = data.username.strip()
    if data.password and data.password.strip():
        conf["password"] = data.password.strip()
    conf["port"] = int(data.port)
    save_settings(conf)
    return {"ok": True, "message": "Settings saved. Restart service if port was changed."}


@app.get("/health")
async def health():
    return {"status": "ok"}
