import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from app import storage
from app.xui_client import XUIClient

logger = logging.getLogger("scheduler")
scheduler = AsyncIOScheduler(timezone="UTC")


def _make_job_id(schedule_id: str, action: str) -> str:
    return f"{schedule_id}_{action}"


def is_time_in_range(enable_time: str, disable_time: str, tz_name: str = "Asia/Tehran") -> bool:
    """
    Check if current time in the specified timezone is within [enable_time, disable_time).
    Properly handles both regular intervals (e.g. 02:00 - 07:00) and
    overnight intervals spanning midnight (e.g. 23:00 - 06:00).
    """
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")

    now = datetime.now(tz)
    cur_mins = now.hour * 60 + now.minute

    try:
        eh, em = map(int, enable_time.split(":"))
        dh, dm = map(int, disable_time.split(":"))
    except Exception:
        return False

    en_mins = eh * 60 + em
    dis_mins = dh * 60 + dm

    if en_mins == dis_mins:
        return False

    if en_mins < dis_mins:
        # Standard day range, e.g. 02:00 to 07:00 or 10:00 to 18:00
        return en_mins <= cur_mins < dis_mins
    else:
        # Overnight range, e.g. 22:00 to 06:00
        return cur_mins >= en_mins or cur_mins < dis_mins


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
        context = "Auto-Synced (Initial Window Check)" if is_sync else "Scheduled Cron Trigger"
        details = (
            f"[{context}] Inbound successfully set to {status_text}. "
            f"Active window: {schedule.enable_time} - {schedule.disable_time} ({schedule.timezone})"
        )
        logger.info(f"{panel.name} | {schedule.inbound_remark} -> {status_text}")
        storage.add_log(panel.name, schedule.inbound_remark, action, "SUCCESS", details)
    except Exception as e:
        err_msg = f"Failed to {action} inbound {schedule.inbound_id}: {str(e)}"
        logger.error(err_msg)
        storage.add_log(panel.name, schedule.inbound_remark, action, "FAILED", err_msg)


async def sync_schedule_state(schedule_id: str):
    """
    Checks if current time is within schedule window and applies state immediately.
    Solves the problem where a schedule added at 12:49 PM for 02:00-07:00 would stay ON
    until 07:00 next day.
    """
    schedule = storage.get_schedule(schedule_id)
    if not schedule or not schedule.enabled:
        return

    should_be_enabled = is_time_in_range(schedule.enable_time, schedule.disable_time, schedule.timezone)
    action = "enable" if should_be_enabled else "disable"
    await _run_action(schedule_id, action, is_sync=True)


def _parse_cron(time_str: str, tz: str):
    h, m = map(int, time_str.split(":"))
    return CronTrigger(hour=h, minute=m, timezone=tz)


def register_schedule(schedule_id: str):
    schedule = storage.get_schedule(schedule_id)
    if not schedule:
        return

    unregister_schedule(schedule_id)
    if not schedule.enabled:
        return

    # 1. Job to Turn ON
    scheduler.add_job(
        _run_action,
        trigger=_parse_cron(schedule.enable_time, schedule.timezone),
        args=[schedule_id, "enable"],
        id=_make_job_id(schedule_id, "enable"),
        replace_existing=True,
        misfire_grace_time=180,
    )

    # 2. Job to Turn OFF
    scheduler.add_job(
        _run_action,
        trigger=_parse_cron(schedule.disable_time, schedule.timezone),
        args=[schedule_id, "disable"],
        id=_make_job_id(schedule_id, "disable"),
        replace_existing=True,
        misfire_grace_time=180,
    )

    logger.info(
        f"Registered schedule {schedule.id}: ON @ {schedule.enable_time}, "
        f"OFF @ {schedule.disable_time} [{schedule.timezone}]"
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
            # Sync each active schedule to ensure inbounds match current time window
            try:
                await sync_schedule_state(s.id)
            except Exception as e:
                logger.error(f"Error syncing schedule {s.id}: {e}")
    logger.info(f"Loaded and verified {len(schedules)} schedule(s).")
