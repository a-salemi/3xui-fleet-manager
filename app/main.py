import uuid
import time
import json
import logging
import asyncio
import urllib.parse
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, Request, HTTPException, Depends, Form, Response, UploadFile, File
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app import storage, scheduler as sched, users, two_factor
from app.config import load_settings, save_settings
from app.system import get_system_metrics
from app.telegram import test_telegram_alert, send_telegram_backup
from app.models import (
    PanelConfigCreate, ScheduleEntryCreate, ScheduleEntryUpdate,
    PanelConfig, ScheduleEntry, GeneralSettingsUpdate,
    TelegramTestRequest, UserCreate, UserUpdate,
    TwoFactorVerifyRequest
)
from app.xui_client import XUIClient

# Maps session_token -> user_dict {"id": ..., "username": ..., "role": ...}
_sessions: Dict[str, Dict[str, Any]] = {}
logger = logging.getLogger("app")

# ─── Login Rate Limiting & Brute-Force Shield ────────────────────────────────
_login_failures: Dict[str, List[float]] = {}
_locked_ips: Dict[str, float] = {}

MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION_SEC = 900  # 15 minutes
WINDOW_DURATION_SEC = 600   # 10 minutes

def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"

def _check_ip_locked(ip: str) -> Optional[int]:
    now = time.time()
    if ip in _locked_ips:
        if now < _locked_ips[ip]:
            return int(_locked_ips[ip] - now)
        else:
            del _locked_ips[ip]
            _login_failures.pop(ip, None)
    return None

def _record_login_failure(ip: str):
    now = time.time()
    attempts = _login_failures.get(ip, [])
    attempts = [t for t in attempts if now - t < WINDOW_DURATION_SEC]
    attempts.append(now)
    _login_failures[ip] = attempts
    if len(attempts) >= MAX_LOGIN_ATTEMPTS:
        _locked_ips[ip] = now + LOCKOUT_DURATION_SEC
        _login_failures.pop(ip, None)

def _record_login_success(ip: str):
    _login_failures.pop(ip, None)
    _locked_ips.pop(ip, None)


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
async def do_login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    totp_code: Optional[str] = Form(None)
):
    ip = _get_client_ip(request)
    remaining_lock = _check_ip_locked(ip)
    if remaining_lock:
        mins = max(1, round(remaining_lock / 60))
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "error": f"Too many failed login attempts! IP locked for {mins} more minute(s) (Brute-Force Shield Active)."
            },
            status_code=429
        )

    user = users.authenticate(username, password)
    if user:
        # Check if Two-Factor Authentication (TOTP) is active
        if two_factor.is_2fa_enabled():
            if totp_code:
                cfg = load_settings().get("two_factor", {})
                secret = cfg.get("secret", "")
                if two_factor.verify_totp(secret, totp_code):
                    _record_login_success(ip)
                    token = str(uuid.uuid4())
                    _sessions[token] = user
                    response = RedirectResponse("/dashboard", status_code=302)
                    response.set_cookie("session", token, httponly=True, samesite="lax", max_age=86400 * 7)
                    return response
                else:
                    _record_login_failure(ip)
                    return templates.TemplateResponse(
                        "login.html",
                        {
                            "request": request,
                            "two_factor_step": True,
                            "username": username,
                            "password": password,
                            "error": "Invalid 6-digit Authenticator code. Please check your app and try again."
                        },
                        status_code=401
                    )
            # Credentials are valid, display 2FA verification step
            return templates.TemplateResponse(
                "login.html",
                {
                    "request": request,
                    "two_factor_step": True,
                    "username": username,
                    "password": password,
                    "error": None
                }
            )

        # 2FA not enabled - login directly
        _record_login_success(ip)
        token = str(uuid.uuid4())
        _sessions[token] = user
        response = RedirectResponse("/dashboard", status_code=302)
        response.set_cookie("session", token, httponly=True, samesite="lax", max_age=86400 * 7)
        return response

    _record_login_failure(ip)
    remaining_lock = _check_ip_locked(ip)
    if remaining_lock:
        mins = round(LOCKOUT_DURATION_SEC / 60)
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "error": f"Exceeded {MAX_LOGIN_ATTEMPTS} failed attempts. Your IP has been temporarily locked for {mins} minutes."
            },
            status_code=429
        )

    attempts_count = len(_login_failures.get(ip, []))
    remaining_attempts = max(0, MAX_LOGIN_ATTEMPTS - attempts_count)
    return templates.TemplateResponse(
        "login.html",
        {
            "request": request,
            "error": f"Invalid username or password. ({remaining_attempts} attempt(s) remaining before IP lockout)"
        }
    )


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


@app.put("/api/panels/{panel_id}")
async def api_update_panel(panel_id: str, data: PanelConfigCreate, _=Depends(require_operator_or_admin)):
    existing = storage.get_panel(panel_id)
    if not existing:
        raise HTTPException(404, "Panel not found")
    updated = PanelConfig(
        id=panel_id,
        name=data.name.strip(),
        url=data.url.strip(),
        token=data.token.strip(),
        path_prefix=data.path_prefix.strip() if data.path_prefix else "/panel"
    )
    storage.save_panel(updated)
    storage.add_log(updated.name, "Panel Config", "UPDATE", "SUCCESS", f"Panel {updated.name} updated ({updated.url})")
    return updated.model_dump()


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


@app.get("/api/panels/{panel_id}/ping")
async def api_ping_panel(panel_id: str, _=Depends(get_current_user)):
    panel = storage.get_panel(panel_id)
    if not panel:
        raise HTTPException(404, "Panel not found")
    client = XUIClient(panel.url, panel.token, panel.path_prefix)
    try:
        latency = await client.ping()
        return {"ok": True, "latency_ms": latency}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/panels/{panel_id}/xray/{action}")
async def api_panel_xray_action(panel_id: str, action: str, _=Depends(require_operator_or_admin)):
    if action not in ("restart", "stop", "start"):
        raise HTTPException(400, "Invalid action. Must be restart, stop, or start.")
    panel = storage.get_panel(panel_id)
    if not panel:
        raise HTTPException(404, "Panel not found")
    client = XUIClient(panel.url, panel.token, panel.path_prefix)
    try:
        if action == "restart":
            await client.restart_xray_service()
        elif action == "stop":
            await client.stop_xray_service()
        elif action == "start":
            await client.start_xray_service()
        storage.add_log(panel.name, "Xray Core", action.upper(), "SUCCESS", f"Manual {action} executed")
        return {"ok": True, "message": f"Xray service {action}ed successfully."}
    except Exception as e:
        storage.add_log(panel.name, "Xray Core", action.upper(), "FAILED", str(e))
        raise HTTPException(502, detail=str(e))


# ─── API: Schedules ───────────────────────────────────────────────────────────

@app.get("/api/schedules")
async def api_list_schedules(_=Depends(get_current_user)):
    schedules = storage.get_schedules()
    panels = storage.get_panels()
    panel_map = {p.id: p.name for p in panels}
    res = []
    for s in schedules:
        dump = s.model_dump()
        if not dump.get("panel_name") or dump.get("panel_name") in ("Unknown Panel", "Unknown"):
            if dump.get("panel_id") == "all":
                dump["panel_name"] = "All Panels (Fleet)"
            elif dump.get("panel_id") in panel_map:
                dump["panel_name"] = panel_map[dump["panel_id"]]
            elif len(panels) == 1:
                dump["panel_name"] = panels[0].name
            elif dump.get("action_type") == "custom_command":
                dump["panel_name"] = "Host Server"
            elif dump.get("action_type") == "telegram_alert":
                dump["panel_name"] = "Telegram Bot"
        res.append(dump)
    return res


@app.post("/api/schedules")
async def api_add_schedule(data: ScheduleEntryCreate, user: Dict[str, Any] = Depends(require_operator_or_admin)):
    if data.action_type == "custom_command":
        if user.get("role") != "admin":
            raise HTTPException(403, "Linux shell commands can only be scheduled by Full Administrators.")
        if os.getenv("ENABLE_SHELL_COMMANDS", "true").lower() in ("false", "0", "no"):
            raise HTTPException(403, "Linux shell execution is disabled via ENABLE_SHELL_COMMANDS=false.")

    data_dict = data.model_dump()
    if not data_dict.get("panel_name"):
        if data.panel_id == "all":
            data_dict["panel_name"] = "All Panels (Fleet)"
        elif data.panel_id:
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
        else:
            data_dict["panel_name"] = "Host Server"

    schedule = ScheduleEntry(id=str(uuid.uuid4()), enabled=True, **data_dict)
    storage.save_schedule(schedule)
    sched.register_schedule(schedule.id)
    # Immediately check window and sync inbound state
    asyncio.create_task(sched.sync_schedule_state(schedule.id))
    return schedule.model_dump()


@app.put("/api/schedules/{schedule_id}")
async def api_update_schedule(schedule_id: str, data: ScheduleEntryUpdate, user: Dict[str, Any] = Depends(require_operator_or_admin)):
    schedule = storage.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")

    if data.action_type == "custom_command" or (getattr(schedule, "action_type", "") == "custom_command" and data.command is not None):
        if user.get("role") != "admin":
            raise HTTPException(403, "Linux shell commands can only be updated by Full Administrators.")

    updated_data = schedule.model_dump()
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            updated_data[field] = value

    if "panel_id" in data.model_dump(exclude_unset=True) or not updated_data.get("panel_name"):
        target_pid = updated_data.get("panel_id")
        if target_pid == "all":
            updated_data["panel_name"] = "All Panels (Fleet)"
        elif target_pid:
            p = storage.get_panel(target_pid)
            if p:
                updated_data["panel_name"] = p.name
        else:
            updated_data["panel_name"] = "Host Server"

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
async def api_run_now(schedule_id: str, action: str, user: Dict[str, Any] = Depends(require_operator_or_admin)):
    if action not in ("enable", "disable", "run", "stop", "start"):
        raise HTTPException(400, "Invalid action. Must be enable, disable, run, stop, or start.")
    schedule = storage.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    if getattr(schedule, "action_type", "inbound_window") == "custom_command":
        if user.get("role") != "admin":
            raise HTTPException(403, "Executing Linux shell commands requires Full Administrator role.")
    await sched._run_action(schedule_id, action, is_sync=False)
    return {"ok": True}


@app.get("/api/schedules/{schedule_id}/stats")
async def api_schedule_stats(schedule_id: str, _=Depends(get_current_user)):
    schedule = storage.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    panel = storage.get_panel(schedule.panel_id)
    if not panel:
        raise HTTPException(404, "Target panel not found")

    client = XUIClient(panel.url, panel.token, panel.path_prefix)
    try:
        inbound = await client.get_inbound(schedule.inbound_id)
        up_bytes = inbound.get("up", 0)
        down_bytes = inbound.get("down", 0)
        total_limit = inbound.get("total", 0)
        client_stats = inbound.get("clientStats", [])
        return {
            "ok": True,
            "id": schedule.inbound_id,
            "remark": inbound.get("remark", schedule.inbound_remark),
            "port": inbound.get("port"),
            "protocol": inbound.get("protocol", "unknown"),
            "enabled": inbound.get("enable", False),
            "up_bytes": up_bytes,
            "down_bytes": down_bytes,
            "total_bytes": up_bytes + down_bytes,
            "limit_bytes": total_limit,
            "client_count": len(client_stats) if client_stats else 0
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


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


# ─── API: Two-Factor Authentication (2FA / TOTP) ──────────────────────────────

@app.get("/api/settings/2fa/status")
async def api_2fa_status(_=Depends(require_admin)):
    return two_factor.get_2fa_status()


@app.post("/api/settings/2fa/setup")
async def api_2fa_setup(user: Dict[str, Any] = Depends(require_admin)):
    secret = two_factor.generate_secret()
    uri = two_factor.get_provisioning_uri(secret, account_name=user.get("username", "admin"))
    return {"secret": secret, "uri": uri}


@app.post("/api/settings/2fa/enable")
async def api_2fa_enable(data: TwoFactorVerifyRequest, _=Depends(require_admin)):
    ok = two_factor.enable_2fa(data.secret, data.code)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid 6-digit code. Please check that your device time is accurate and retry.")
    storage.add_log("Security Shield", "2FA (TOTP)", "ENABLE", "SUCCESS", "Two-Factor Authentication enabled by Administrator")
    return {"ok": True, "message": "Two-Factor Authentication enabled successfully!"}


@app.post("/api/settings/2fa/disable")
async def api_2fa_disable(_=Depends(require_admin)):
    two_factor.disable_2fa()
    storage.add_log("Security Shield", "2FA (TOTP)", "DISABLE", "WARNING", "Two-Factor Authentication disabled by Administrator")
    return {"ok": True, "message": "Two-Factor Authentication disabled."}


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


# ─── API: Backup & Restore (Admin Only) ───────────────────────────────────────

@app.get("/api/backup")
async def api_export_backup(_=Depends(require_admin)):
    data = storage.create_backup_data()
    content = json.dumps(data, indent=2, ensure_ascii=False)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"3xui_fleet_backup_{timestamp}.json"
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.post("/api/backup/telegram")
async def api_backup_telegram(_=Depends(require_admin)):
    try:
        data = storage.create_backup_data()
        content = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        filename = f"3xui_fleet_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        caption = (
            f"💾 <b>3X-UI Fleet Automation Backup</b>\n\n"
            f"📅 <b>Date:</b> <code>{timestamp}</code>\n"
            f"🖥 <b>Panels:</b> <code>{len(data.get('panels', []))}</code>\n"
            f"⏰ <b>Schedules:</b> <code>{len(data.get('schedules', []))}</code>\n"
            f"👥 <b>Users:</b> <code>{len(data.get('users', []))}</code>\n\n"
            f"<i>Keep this file safe to restore your entire manager configuration anytime.</i>"
        )
        await send_telegram_backup(filename, content, caption)
        return {"ok": True, "message": "Backup document delivered to your Telegram chat successfully!"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/restore")
async def api_restore_backup(request: Request, _=Depends(require_admin)):
    try:
        body = await request.json()
        storage.restore_backup_data(body)
        asyncio.create_task(sched.reload_all_schedules_async())
        return {"ok": True, "message": "Configuration restored successfully! All schedules reloaded."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to restore backup: {str(e)}")


@app.get("/health")
async def health():
    return {"status": "ok"}
