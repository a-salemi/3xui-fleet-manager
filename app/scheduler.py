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
    panel = storage.get_panel(schedule.panel_id)
    if not panel:
        msg = f"Panel not found for schedule {schedule_id}"
        logger.warning(msg)
        storage.add_log("Unknown", schedule.inbound_remark, action, "FAILED", msg)
        return

    client = XUIClient(panel.url, panel.token, panel.path_prefix)
    target_enable = (action == "enable")

    try:
        await client.set_inbound_enabled(schedule.inbound_id, target_enable)
        status_text = "ENABLED 🟢" if target_enable else "DISABLED 🔴"
        context = "Initial Sync" if is_sync else "Cron Trigger"
        details = (
            f"[{context}] Inbound successfully set to {status_text}. "
            f"Active window: {schedule.enable_time} - {schedule.disable_time} ({schedule.timezone})"
        )
        logger.info(f"{panel.name} | {schedule.inbound_remark} -> {status_text}")
        storage.add_log(panel.name, schedule.inbound_remark, action, "SUCCESS", details)

        # Telegram Notification Alert
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
        storage.add_log(panel.name, schedule.inbound_remark, action, "FAILED", err_msg)

        # Telegram Failure Alert
        tg_fail = (
            f"⚠️ <b>3X-UI Automation FAILED!</b>\n\n"
            f"🖥 <b>Panel:</b> <code>{panel.name}</code>\n"
            f"📡 <b>Inbound:</b> <code>{schedule.inbound_remark}</code> (#{schedule.inbound_id})\n"
            f"❌ <b>Error:</b> <code>{str(e)}</code>"
        )
        asyncio.create_task(send_telegram_alert(tg_fail))


async def sync_schedule_state(schedule_id: str):
    schedule = storage.get_schedule(schedule_id)
    if not schedule or not schedule.enabled:
        return

    days = schedule.days if getattr(schedule, "days", None) else [0, 1, 2, 3, 4, 5, 6]
    should_be_enabled = is_time_in_range(schedule.enable_time, schedule.disable_time, schedule.timezone, days)
    action = "enable" if should_be_enabled else "disable"
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

    scheduler.add_job(
        _run_action,
        trigger=_parse_cron(schedule.enable_time, schedule.timezone, days),
        args=[schedule_id, "enable"],
        id=_make_job_id(schedule_id, "enable"),
        replace_existing=True,
        misfire_grace_time=180,
    )

    # If active window spans midnight, disable time executes on next day
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
        args=[schedule_id, "disable"],
        id=_make_job_id(schedule_id, "disable"),
        replace_existing=True,
        misfire_grace_time=180,
    )

    logger.info(
        f"Registered schedule {schedule.id}: ON @ {schedule.enable_time}, "
        f"OFF @ {schedule.disable_time} [{schedule.timezone}] (Days: {days})"
    )


def unregister_schedule(schedule_id: str):
    for action in ("enable", "disable"):
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
