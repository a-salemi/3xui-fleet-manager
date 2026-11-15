import re
import httpx
from typing import Optional, List, Dict, Any


class BearerAuth(httpx.Auth):
    """Ensures Authorization header persists across all redirects (e.g. http -> https)."""
    def __init__(self, token: str):
        self.token = token

    def auth_flow(self, request):
        request.headers["Authorization"] = f"Bearer {self.token}"
        yield request


class XUIClient:
    """Communicates with 3x-ui panel via its REST API using Bearer token."""

    def __init__(self, base_url: str, token: str, path_prefix: str = "/panel"):
        url = base_url.strip().rstrip("/")
        # Replace localhost with 127.0.0.1 to avoid 30s IPv6 (::1) lookup/timeout on Ubuntu
        url = re.sub(r"://localhost(?=[:/]|$)", "://127.0.0.1", url, flags=re.IGNORECASE)
        self.base_url = url
        self.token = token.strip()
        self.path_prefix = path_prefix.strip().rstrip("/")
        self.auth = BearerAuth(self.token)

    def _api(self, path: str) -> str:
        return f"{self.base_url}{self.path_prefix}/api{path}"

    def _get_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            verify=False,
            follow_redirects=True,
            timeout=8.0,
            auth=self.auth,
            headers={"Content-Type": "application/json", "Accept": "application/json"}
        )

    async def test_connection(self) -> Dict[str, Any]:
        async with self._get_client() as client:
            resp = await client.get(self._api("/inbounds/list"))
            if resp.status_code == 404:
                raise ValueError(f"Endpoint not found (404) at {resp.url}. Check URL and Path Prefix.")
            if resp.status_code == 401 or resp.status_code == 403:
                raise ValueError("Authentication failed (401/403). Check your API Token.")
            resp.raise_for_status()
            data = resp.json()
            if not data.get("success", False):
                raise ValueError(data.get("msg", "Unknown error returned by 3X-UI"))
            return data

    async def get_inbounds(self) -> List[Dict[str, Any]]:
        async with self._get_client() as client:
            resp = await client.get(self._api("/inbounds/list"))
            resp.raise_for_status()
            data = resp.json()
            if data.get("success"):
                return data.get("obj", [])
            raise ValueError(data.get("msg", "Failed to get inbounds"))

    async def get_inbound(self, inbound_id: int) -> Dict[str, Any]:
        async with self._get_client() as client:
            resp = await client.get(self._api(f"/inbounds/get/{inbound_id}"))
            resp.raise_for_status()
            data = resp.json()
            if data.get("success"):
                return data.get("obj", {})
            raise ValueError(data.get("msg", "Failed to get inbound"))

    async def set_inbound_enabled(self, inbound_id: int, enabled: bool) -> bool:
        """Fetch inbound, toggle enable field, then update."""
        inbound = await self.get_inbound(inbound_id)
        inbound["enable"] = enabled
        async with self._get_client() as client:
            resp = await client.post(
                self._api(f"/inbounds/update/{inbound_id}"),
                json=inbound,
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("success"):
                return True
            raise ValueError(data.get("msg", "Failed to update inbound"))
