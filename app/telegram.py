import logging
import httpx
from typing import Optional, Dict, Any
from app.config import load_settings

logger = logging.getLogger("telegram")


async def send_telegram_alert(message_html: str) -> bool:
    """
    Sends an HTML formatted alert to the configured Telegram Chat ID.
    Supports optional SOCKS5 proxy and custom Telegram Bot API Server.
    """
    settings = load_settings()
    tg = settings.get("telegram", {})
    if not tg.get("enabled", False):
        return False

    bot_token = tg.get("bot_token", "").strip()
    chat_id = tg.get("chat_id", "").strip()
    if not bot_token or not chat_id:
        return False

    api_server = tg.get("api_server", "").strip().rstrip("/")
    if not api_server:
        api_server = "https://api.telegram.org"

    url = f"{api_server}/bot{bot_token}/sendMessage"

    payload = {
        "chat_id": chat_id,
        "text": message_html,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }

    socks_proxy = tg.get("socks_proxy", "").strip()
    proxy = socks_proxy if socks_proxy else None

    try:
        async with httpx.AsyncClient(proxy=proxy, timeout=12.0, verify=False) as client:
            resp = await client.post(url, json=payload)
            resp_data = resp.json()
            if not resp_data.get("ok", False):
                logger.error(f"Telegram API Error: {resp_data.get('description', 'Unknown error')}")
                return False
            return True
    except Exception as e:
        logger.error(f"Failed to deliver Telegram notification: {e}")
        return False


async def test_telegram_alert(bot_token: str, chat_id: str, socks_proxy: str = "", api_server: str = "") -> Dict[str, Any]:
    """
    Sends a test verification message to ensure token, chat_id, proxy, and api_server are working.
    """
    bot_token = bot_token.strip()
    chat_id = str(chat_id).strip()
    api_server = api_server.strip().rstrip("/") or "https://api.telegram.org"
    url = f"{api_server}/bot{bot_token}/sendMessage"

    test_msg = (
        "⚡ <b>3X-UI Inbound Manager — Connection Test</b>\n\n"
        "✅ <i>Telegram bot notification channel verified successfully!</i>\n"
        "All scheduled inbound automations and system alerts will be sent here."
    )

    payload = {
        "chat_id": chat_id,
        "text": test_msg,
        "parse_mode": "HTML"
    }

    proxy = socks_proxy.strip() if socks_proxy and socks_proxy.strip() else None

    try:
        async with httpx.AsyncClient(proxy=proxy, timeout=15.0, verify=False) as client:
            resp = await client.post(url, json=payload)
            data = resp.json()
            if not data.get("ok", False):
                desc = data.get("description", "Unknown Telegram API rejection")
                raise ValueError(f"Telegram error: {desc}")
            return {"ok": True, "message": "Test notification delivered to Telegram successfully!"}
    except Exception as e:
        raise ValueError(f"Connection to Telegram failed: {str(e)}")
