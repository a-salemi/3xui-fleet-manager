import httpx
from typing import Optional, List, Dict, Any


class XUIClient:
    """Communicates with 3x-ui panel via its REST API using Bearer token."""

    def __init__(self, base_url: str, token: str, path_prefix: str = "/panel"):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.path_prefix = path_prefix.rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def _api(self, path: str) -> str:
        return f"{self.base_url}{self.path_prefix}/api{path}"

    async def test_connection(self) -> Dict[str, Any]:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.get(self._api("/inbounds/list"), headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    async def get_inbounds(self) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.get(self._api("/inbounds/list"), headers=self.headers)
            resp.raise_for_status()
            data = resp.json()
            if data.get("success"):
                return data.get("obj", [])
            raise ValueError(data.get("msg", "Failed to get inbounds"))

    async def get_inbound(self, inbound_id: int) -> Dict[str, Any]:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.get(self._api(f"/inbounds/get/{inbound_id}"), headers=self.headers)
            resp.raise_for_status()
            data = resp.json()
            if data.get("success"):
                return data.get("obj", {})
            raise ValueError(data.get("msg", "Failed to get inbound"))

    async def set_inbound_enabled(self, inbound_id: int, enabled: bool) -> bool:
        """Fetch inbound, toggle enable field, then update."""
        inbound = await self.get_inbound(inbound_id)
        inbound["enable"] = enabled
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.post(
                self._api(f"/inbounds/update/{inbound_id}"),
                headers=self.headers,
                json=inbound,
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("success"):
                return True
            raise ValueError(data.get("msg", "Failed to update inbound"))
