from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class PanelConfig(BaseModel):
    id: str
    name: str
    url: str
    token: str
    path_prefix: str = "/panel"


class ScheduleEntry(BaseModel):
    id: str
    panel_id: str
    inbound_id: int
    inbound_remark: str
    enable_time: str
    disable_time: str
    enabled: bool = True
    timezone: str = "Asia/Tehran"


class PanelConfigCreate(BaseModel):
    name: str
    url: str
    token: str
    path_prefix: str = "/panel"


class ScheduleEntryCreate(BaseModel):
    panel_id: str
    inbound_id: int
    inbound_remark: str
    enable_time: str
    disable_time: str
    timezone: str = "Asia/Tehran"


class ScheduleEntryUpdate(BaseModel):
    panel_id: Optional[str] = None
    inbound_id: Optional[int] = None
    inbound_remark: Optional[str] = None
    enable_time: Optional[str] = None
    disable_time: Optional[str] = None
    timezone: Optional[str] = None
    enabled: Optional[bool] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class TelegramSettings(BaseModel):
    enabled: bool = False
    bot_token: str = ""
    chat_id: str = ""
    socks_proxy: Optional[str] = ""
    api_server: Optional[str] = ""


class TelegramTestRequest(BaseModel):
    bot_token: str
    chat_id: str
    socks_proxy: Optional[str] = ""
    api_server: Optional[str] = ""


class GeneralSettingsUpdate(BaseModel):
    port: int = 8181
    telegram: TelegramSettings


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "operator"


class UserUpdate(BaseModel):
    password: Optional[str] = None
    role: Optional[str] = None
