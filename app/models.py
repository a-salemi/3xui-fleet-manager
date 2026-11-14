from pydantic import BaseModel
from typing import Optional, List


class PanelConfig(BaseModel):
    id: str
    name: str
    url: str  # e.g. http://1.2.3.4:2053
    token: str
    path_prefix: str = "/panel"  # usually /panel


class ScheduleEntry(BaseModel):
    id: str
    panel_id: str
    inbound_id: int
    inbound_remark: str
    enable_time: str   # "HH:MM"
    disable_time: str  # "HH:MM"
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


class LoginRequest(BaseModel):
    username: str
    password: str
