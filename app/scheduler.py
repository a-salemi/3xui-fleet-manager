import logging
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from app import storage
from app.xui_client import XUIClient

logger = logging.getLogger("scheduler")
scheduler = AsyncIOScheduler(timezone="UTC")


def _make_job_id(schedule_id: str, action: str) -> str:
    return f"{schedule_id}_{action}"


async def _run_action(schedule_id: str, action: str):
    schedule = storage.get_schedule(schedule_id)
    if not schedule or not schedule.enabled:
        return
    panel = storage.get_panel(schedule.panel_id)
    if not panel:
        logger.warning(f"Panel {schedule.panel_id} not found for schedule {schedule_id}")
        return
    client = XUIClient(panel.url, panel.token, panel.path_prefix)
    enabled = action == "enable"
    try:
        await client.set_inbound_enabled(schedule.inbound_id, enabled)
        logger.info(
            f"[{datetime.now().isoformat()}] Inbound {schedule.inbound_id} "
            f"({schedule.inbound_remark}) set to {'ENABLED' if enabled else 'DISABLED'}"
        )
    except Exception as e:
        logger.error(f"Failed to {action} inbound {schedule.inbound_id}: {e}")


def _parse_cron(time_str: str, tz: str):
    """Convert HH:MM to CronTrigger args."""
    h, m = map(int, time_str.split(":"))
    return CronTrigger(hour=h, minute=m, timezone=tz)


def register_schedule(schedule_id: str):
    schedule = storage.get_schedule(schedule_id)
    if not schedule:
        return
    # Remove old jobs if any
    unregister_schedule(schedule_id)
    if not schedule.enabled:
        return

    scheduler.add_job(
        _run_action,
        trigger=_parse_cron(schedule.enable_time, schedule.timezone),
        args=[schedule_id, "enable"],
        id=_make_job_id(schedule_id, "enable"),
        replace_existing=True,
        misfire_grace_time=120,
    )
    scheduler.add_job(
        _run_action,
        trigger=_parse_cron(schedule.disable_time, schedule.timezone),
        args=[schedule_id, "disable"],
        id=_make_job_id(schedule_id, "disable"),
        replace_existing=True,
        misfire_grace_time=120,
    )
    logger.info(
        f"Registered schedule {schedule_id}: "
        f"enable={schedule.enable_time}, disable={schedule.disable_time} [{schedule.timezone}]"
    )


def unregister_schedule(schedule_id: str):
    for action in ("enable", "disable"):
        job_id = _make_job_id(schedule_id, action)
        if scheduler.get_job(job_id):
            scheduler.remove_job(job_id)


def reload_all_schedules():
    schedules = storage.get_schedules()
    for s in schedules:
        register_schedule(s.id)
    logger.info(f"Loaded {len(schedules)} schedule(s) from storage.")
