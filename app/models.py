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
    action_type: str = "inbound_window"
    task_name: Optional[str] = ""
    panel_id: Optional[str] = ""
    panel_name: Optional[str] = ""
    inbound_id: Optional[int] = None
    inbound_remark: Optional[str] = ""
    enable_time: str = "02:00"
    disable_time: Optional[str] = "07:00"
    enabled: bool = True
    timezone: str = "Asia/Tehran"
    days: List[int] = [0, 1, 2, 3, 4, 5, 6]
    command: Optional[str] = ""
    api_method: Optional[str] = "POST"
    api_endpoint: Optional[str] = ""
    api_payload: Optional[str] = ""
    message: Optional[str] = ""


class PanelConfigCreate(BaseModel):
    name: str
    url: str
    token: str
    path_prefix: str = "/panel"


class ScheduleEntryCreate(BaseModel):
    action_type: Optional[str] = "inbound_window"
    task_name: Optional[str] = ""
    panel_id: Optional[str] = ""
    panel_name: Optional[str] = ""
    inbound_id: Optional[int] = None
    inbound_remark: Optional[str] = ""
    enable_time: str
    disable_time: Optional[str] = ""
    timezone: str = "Asia/Tehran"
    days: Optional[List[int]] = [0, 1, 2, 3, 4, 5, 6]
    command: Optional[str] = ""
    api_method: Optional[str] = "POST"
    api_endpoint: Optional[str] = ""
    api_payload: Optional[str] = ""
    message: Optional[str] = ""


class ScheduleEntryUpdate(BaseModel):
    action_type: Optional[str] = None
    task_name: Optional[str] = None
    panel_id: Optional[str] = None
    panel_name: Optional[str] = None
    inbound_id: Optional[int] = None
    inbound_remark: Optional[str] = None
    enable_time: Optional[str] = None
    disable_time: Optional[str] = None
    timezone: Optional[str] = None
    enabled: Optional[bool] = None
    days: Optional[List[int]] = None
    command: Optional[str] = None
    api_method: Optional[str] = None
    api_endpoint: Optional[str] = None
    api_payload: Optional[str] = None
    message: Optional[str] = None


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


class TwoFactorSetupResponse(BaseModel):
    secret: str
    uri: str


class TwoFactorVerifyRequest(BaseModel):
    secret: str
    code: str


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "operator"


class UserUpdate(BaseModel):
    password: Optional[str] = None
    role: Optional[str] = None
