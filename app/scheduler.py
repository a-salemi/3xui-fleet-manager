import logging
import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List, Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from app import storage
from app.xui_client import XUIClient
from app.telegram import send_telegram_alert

logger = logging.getLogger("scheduler")
scheduler = AsyncIOScheduler(timezone="UTC")


def _make_job_id(schedule_id: str, action: str) -> str:
    return f"{schedule_id}_{action}"


def is_time_in_range(enable_time: str, disable_time: str, tz_name: str = "Asia/Tehran", days: Optional[List[int]] = None) -> bool:
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")

    now = datetime.now(tz)
    cur_mins = now.hour * 60 + now.minute
    today_weekday = now.weekday()  # 0 = Monday ... 6 = Sunday

    try:
        eh, em = map(int, enable_time.split(":"))
        dh, dm = map(int, disable_time.split(":"))
    except Exception:
        return False

    en_mins = eh * 60 + em
    dis_mins = dh * 60 + dm

    if en_mins == dis_mins:
        return False

    active_days = days if (days and len(days) > 0) else [0, 1, 2, 3, 4, 5, 6]

    if en_mins < dis_mins:
        if len(active_days) < 7 and today_weekday not in active_days:
            return False
        return en_mins <= cur_mins < dis_mins
    else:
        # Crosses midnight (e.g. 23:00 to 07:00)
        if cur_mins >= en_mins:
            # Active window started today
            if len(active_days) < 7 and today_weekday not in active_days:
                return False
            return True
        elif cur_mins < dis_mins:
            # Active window started yesterday
            yesterday_weekday = (today_weekday - 1) % 7
            if len(active_days) < 7 and yesterday_weekday not in active_days:
                return False
            return True
        return False


async def _run_action(schedule_id: str, action: str, is_sync: bool = False):
    schedule = storage.get_schedule(schedule_id)
    if not schedule or not schedule.enabled:
        return

    action_type = getattr(schedule, "action_type", "inbound_window") or "inbound_window"
    context = "Initial Sync" if is_sync else "Scheduled Automation"

    # ─── 1. Custom Shell / Bash Command ──────────────────────────────────────────
    if action_type == "custom_command":
        if os.getenv("ENABLE_SHELL_COMMANDS", "true").lower() in ("false", "0", "no"):
            storage.add_log("Host Server", schedule.task_name or "Shell", "SECURITY", "BLOCKED", "Shell commands globally disabled via ENABLE_SHELL_COMMANDS=false")
            return

        cmd = (schedule.command or "").strip()
        task_label = schedule.task_name or f"Shell: {cmd[:30]}"
        if not cmd:
            storage.add_log("Host Server", task_label, "COMMAND", "FAILED", "Empty command specified")
            return

        # 🛡️ DESTRUCTIVE COMMAND DEFENSE SHIELD (Wipe / Fork-bomb / Host Destroyer Protection)
        import re
        BLOCKED_PATTERNS = [
            r"\brm\s+-[rfRF]{1,4}\s+/\b",
            r"\brm\s+-[rfRF]{1,4}\s+/\*",
            r"\bmkfs\b",
            r"\bdd\s+if=",
            r":\(\)\s*\{\s*:\|:&\s*\};:",  # fork bomb
            r"\bchmod\s+-[rR]{1,2}\s+[07]{3,4}\s+/\b",
            r">+\s*/etc/(passwd|shadow|fstab)",
            r">+\s*/dev/(sd|nvme|vd)",
        ]
        for pattern in BLOCKED_PATTERNS:
            if re.search(pattern, cmd):
                sec_msg = f"SECURITY SHIELD: Destructive command signature blocked: {cmd}"
                logger.error(sec_msg)
                storage.add_log("Host Server", task_label, "SECURITY", "BLOCKED", sec_msg)
                tg_alert = (
                    f"🚨 <b>CRITICAL SECURITY SHIELD TRIGGERED</b>\n\n"
                    f"⚠️ <b>Blocked Command:</b> <code>{cmd}</code>\n"
                    f"🛑 <b>Reason:</b> Matches destructive system wipe signature.\n"
                    f"🛡️ Action was aborted immediately."
                )
                asyncio.create_task(send_telegram_alert(tg_alert))
                return

        try:
            proc = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30.0)
            out_str = (stdout.decode("utf-8", errors="replace") + "\n" + stderr.decode("utf-8", errors="replace")).strip()
            status = "SUCCESS" if proc.returncode == 0 else "WARNING"
            detail = f"Exit code {proc.returncode}. Output:\n{out_str[:350]}"
            storage.add_log("Host Server", task_label, "COMMAND", status, detail)

            tg_msg = (
                f"💻 <b>Linux Shell Command Executed</b>\n\n"
                f"⚡ <b>Task:</b> <code>{task_label}</code>\n"
                f"📟 <b>Command:</b> <code>{cmd[:80]}</code>\n"
                f"📊 <b>Exit Code:</b> <code>{proc.returncode}</code>\n"
                f"📝 <b>Output:</b> <pre>{out_str[:350] or 'No output'}</pre>"
            )
            asyncio.create_task(send_telegram_alert(tg_msg))
        except asyncio.TimeoutError:
            storage.add_log("Host Server", task_label, "COMMAND", "TIMEOUT", "Execution timed out after 30 seconds")
            asyncio.create_task(send_telegram_alert(f"⏱ <b>Shell Execution Timeout:</b> Task <code>{task_label}</code> exceeded 30s limit and was terminated."))
        except Exception as e:
            storage.add_log("Host Server", task_label, "COMMAND", "FAILED", str(e))
            asyncio.create_task(send_telegram_alert(f"❌ <b>Command Execution Failed:</b> <code>{str(e)}</code>"))
        return

    # ─── 2. Telegram Alert / Reminder ─────────────────────────────────────────────
    if action_type == "telegram_alert":
        msg_text = (schedule.message or "").strip()
        task_label = schedule.task_name or "Scheduled Alert"
        tg_html = f"📢 <b>Scheduled Notification</b>\n\n{msg_text}"
        await send_telegram_alert(tg_html)
        storage.add_log("Telegram", task_label, "ALERT", "SUCCESS", f"Notification delivered: {msg_text[:100]}")
        return

    # ─── 3. Target Panels Resolution ──────────────────────────────────────────────
    panels = []
    if schedule.panel_id == "all":
        panels = storage.get_panels()
    else:
        p = storage.get_panel(schedule.panel_id)
        if p:
            panels = [p]

    if not panels:
        msg = f"Target panel not found for schedule {schedule_id}"
        storage.add_log("Unknown", schedule.task_name or schedule.inbound_remark or "Task", action, "FAILED", msg)
        return

    # ─── 4. Inbound Window (Enable / Disable) ────────────────────────────────────
    if action_type == "inbound_window":
        panel = panels[0]
        client = XUIClient(panel.url, panel.token, panel.path_prefix)
        target_enable = (action == "enable")
        try:
            await client.set_inbound_enabled(schedule.inbound_id, target_enable)
            status_text = "ENABLED 🟢" if target_enable else "DISABLED 🔴"
            details = (
                f"[{context}] Inbound successfully set to {status_text}. "
                f"Active window: {schedule.enable_time} - {schedule.disable_time} ({schedule.timezone})"
            )
            logger.info(f"{panel.name} | {schedule.inbound_remark} -> {status_text}")
            storage.add_log(panel.name, schedule.inbound_remark or f"Inbound #{schedule.inbound_id}", action, "SUCCESS", details)

            tg_icon = "🟢" if target_enable else "🔴"
            action_title = "ENABLED" if target_enable else "DISABLED"
            tg_html = (
                f"{tg_icon} <b>3X-UI Inbound {action_title}</b>\n\n"
                f"🖥 <b>Panel:</b> <code>{panel.name}</code>\n"
                f"📡 <b>Inbound:</b> <code>{schedule.inbound_remark}</code> (#{schedule.inbound_id})\n"
                f"⏰ <b>Window:</b> <code>{schedule.enable_time} → {schedule.disable_time}</code> ({schedule.timezone})\n"
                f"⚡ <b>Action:</b> {context}"
            )
            asyncio.create_task(send_telegram_alert(tg_html))
        except Exception as e:
            err_msg = f"Failed to {action} inbound {schedule.inbound_id}: {str(e)}"
            logger.error(err_msg)
            storage.add_log(panel.name, schedule.inbound_remark or f"Inbound #{schedule.inbound_id}", action, "FAILED", err_msg)
            tg_fail = (
                f"⚠️ <b>3X-UI Automation FAILED!</b>\n\n"
                f"🖥 <b>Panel:</b> <code>{panel.name}</code>\n"
                f"📡 <b>Inbound:</b> <code>{schedule.inbound_remark}</code> (#{schedule.inbound_id})\n"
                f"❌ <b>Error:</b> <code>{str(e)}</code>"
            )
            asyncio.create_task(send_telegram_alert(tg_fail))
        return

    # ─── 5. Xray Restart ──────────────────────────────────────────────────────────
    if action_type == "xray_restart":
        for panel in panels:
            client = XUIClient(panel.url, panel.token, panel.path_prefix)
            try:
                await client.restart_xray_service()
                storage.add_log(panel.name, "Xray Core", "RESTART", "SUCCESS", f"Xray service restarted successfully on {panel.name}")
                tg_html = (
                    f"🔄 <b>Xray Core Refreshed</b>\n\n"
                    f"🖥 <b>Panel:</b> <code>{panel.name}</code>\n"
                    f"⚡ <b>Status:</b> Service restarted & memory released successfully."
                )
                asyncio.create_task(send_telegram_alert(tg_html))
            except Exception as e:
                storage.add_log(panel.name, "Xray Core", "RESTART", "FAILED", str(e))
                asyncio.create_task(send_telegram_alert(f"⚠️ <b>Xray Restart Failed ({panel.name}):</b> <code>{str(e)}</code>"))
        return

    # ─── 6. Xray Stop / Start Window ──────────────────────────────────────────────
    if action_type == "xray_window":
        for panel in panels:
            client = XUIClient(panel.url, panel.token, panel.path_prefix)
            try:
                if action == "stop":
                    await client.stop_xray_service()
                    act_desc = "STOPPED 🛑"
                else:
                    await client.start_xray_service()
                    act_desc = "STARTED 🟢"
                storage.add_log(panel.name, "Xray Core", action.upper(), "SUCCESS", f"Xray service {act_desc} on {panel.name}")
                tg_html = f"⚡ <b>Xray Service {act_desc}</b>\n\n🖥 <b>Panel:</b> <code>{panel.name}</code>"
                asyncio.create_task(send_telegram_alert(tg_html))
            except Exception as e:
                storage.add_log(panel.name, "Xray Core", action.upper(), "FAILED", str(e))
        return

    # ─── 7. Reset Traffic Counters ────────────────────────────────────────────────
    if action_type == "reset_traffic":
        for panel in panels:
            client = XUIClient(panel.url, panel.token, panel.path_prefix)
            try:
                if schedule.inbound_id:
                    await client.reset_inbound_traffics(schedule.inbound_id)
                    target_name = schedule.inbound_remark or f"Inbound #{schedule.inbound_id}"
                else:
                    await client.reset_all_traffics()
                    target_name = "All Inbounds"
                storage.add_log(panel.name, target_name, "RESET_TRAFFIC", "SUCCESS", f"Traffic counters reset on {panel.name}")
                tg_html = f"📊 <b>Traffic Counters Reset</b>\n\n🖥 <b>Panel:</b> <code>{panel.name}</code>\n📡 <b>Target:</b> {target_name}"
                asyncio.create_task(send_telegram_alert(tg_html))
            except Exception as e:
                storage.add_log(panel.name, "Traffic Counters", "RESET_TRAFFIC", "FAILED", str(e))
        return

    # ─── 8. Custom API Endpoint ───────────────────────────────────────────────────
    if action_type == "custom_api":
        import json
        payload = None
        if schedule.api_payload:
            try:
                payload = json.loads(schedule.api_payload)
            except Exception:
                payload = schedule.api_payload

        for panel in panels:
            client = XUIClient(panel.url, panel.token, panel.path_prefix)
            try:
                res = await client.custom_api_request(schedule.api_method or "POST", schedule.api_endpoint or "/", payload)
                res_str = json.dumps(res, ensure_ascii=False) if isinstance(res, (dict, list)) else str(res)
                storage.add_log(panel.name, f"API {schedule.api_method} {schedule.api_endpoint}", "CUSTOM_API", "SUCCESS", f"Response: {res_str[:300]}")
                tg_html = (
                    f"🌐 <b>Custom 3X-UI API Called</b>\n\n"
                    f"🖥 <b>Panel:</b> <code>{panel.name}</code>\n"
                    f"⚡ <b>Endpoint:</b> <code>{schedule.api_method} {schedule.api_endpoint}</code>\n"
                    f"📝 <b>Response:</b> <pre>{res_str[:300]}</pre>"
                )
                asyncio.create_task(send_telegram_alert(tg_html))
            except Exception as e:
                storage.add_log(panel.name, f"API {schedule.api_endpoint}", "CUSTOM_API", "FAILED", str(e))
                asyncio.create_task(send_telegram_alert(f"⚠️ <b>Custom API Call Failed ({panel.name}):</b> <code>{str(e)}</code>"))
        return


async def sync_schedule_state(schedule_id: str):
    schedule = storage.get_schedule(schedule_id)
    if not schedule or not schedule.enabled:
        return

    action_type = getattr(schedule, "action_type", "inbound_window") or "inbound_window"
    if action_type not in ("inbound_window", "xray_window"):
        return

    days = schedule.days if getattr(schedule, "days", None) else [0, 1, 2, 3, 4, 5, 6]
    should_be_active = is_time_in_range(schedule.enable_time, schedule.disable_time, schedule.timezone, days)
    if action_type == "inbound_window":
        action = "enable" if should_be_active else "disable"
    else:
        action = "stop" if should_be_active else "start"
    await _run_action(schedule_id, action, is_sync=True)


def _parse_cron(time_str: str, tz: str, days: Optional[List[int]] = None):
    h, m = map(int, time_str.split(":"))
    if days and len(days) < 7:
        day_str = ",".join(str(d) for d in sorted(days))
        return CronTrigger(day_of_week=day_str, hour=h, minute=m, timezone=tz)
    return CronTrigger(hour=h, minute=m, timezone=tz)


def register_schedule(schedule_id: str):
    schedule = storage.get_schedule(schedule_id)
    if not schedule:
        return

    unregister_schedule(schedule_id)
    if not schedule.enabled:
        return

    days = schedule.days if getattr(schedule, "days", None) and len(schedule.days) > 0 else [0, 1, 2, 3, 4, 5, 6]
    action_type = getattr(schedule, "action_type", "inbound_window") or "inbound_window"

    if action_type in ("inbound_window", "xray_window"):
        first_action = "enable" if action_type == "inbound_window" else "stop"
        second_action = "disable" if action_type == "inbound_window" else "start"

        scheduler.add_job(
            _run_action,
            trigger=_parse_cron(schedule.enable_time, schedule.timezone, days),
            args=[schedule_id, first_action],
            id=_make_job_id(schedule_id, first_action),
            replace_existing=True,
            misfire_grace_time=180,
        )

        try:
            eh, em = map(int, schedule.enable_time.split(":"))
            dh, dm = map(int, schedule.disable_time.split(":"))
            if eh * 60 + em > dh * 60 + dm:
                disable_days = [(d + 1) % 7 for d in days]
            else:
                disable_days = days
        except Exception:
            disable_days = days

        scheduler.add_job(
            _run_action,
            trigger=_parse_cron(schedule.disable_time, schedule.timezone, disable_days),
            args=[schedule_id, second_action],
            id=_make_job_id(schedule_id, second_action),
            replace_existing=True,
            misfire_grace_time=180,
        )
    else:
        # Single execution actions (xray_restart, reset_traffic, custom_command, custom_api, telegram_alert)
        scheduler.add_job(
            _run_action,
            trigger=_parse_cron(schedule.enable_time, schedule.timezone, days),
            args=[schedule_id, "run"],
            id=_make_job_id(schedule_id, "run"),
            replace_existing=True,
            misfire_grace_time=180,
        )

    logger.info(
        f"Registered schedule {schedule.id} [{action_type}]: Trigger @ {schedule.enable_time} "
        f"[{schedule.timezone}] (Days: {days})"
    )


def unregister_schedule(schedule_id: str):
    for action in ("enable", "disable", "stop", "start", "run"):
        job_id = _make_job_id(schedule_id, action)
        if scheduler.get_job(job_id):
            scheduler.remove_job(job_id)


async def reload_all_schedules_async():
    schedules = storage.get_schedules()
    for s in schedules:
        register_schedule(s.id)
        if s.enabled:
            try:
                await sync_schedule_state(s.id)
            except Exception as e:
                logger.error(f"Error syncing schedule {s.id}: {e}")
    logger.info(f"Loaded and verified {len(schedules)} schedule(s).")
