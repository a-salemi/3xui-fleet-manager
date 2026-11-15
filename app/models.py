from pydantic import BaseModel
from typing import Optional, List


class PanelConfig(BaseModel):
    id: str
    name: str
    url: str  # e.g. https://127.0.0.1:2087/shabgard
    token: str
    path_prefix: str = "/panel"


class ScheduleEntry(BaseModel):
    id: str
    panel_id: str
    inbound_id: int
    inbound_remark: str
    enable_time: str   # "HH:MM" (24-hour format)
    disable_time: str  # "HH:MM" (24-hour format)
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


class SettingsUpdate(BaseModel):
    username: str
    password: Optional[str] = None
    port: int = 8181
