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

    async def ping(self) -> float:
        """Measure round-trip API latency in milliseconds."""
        import time
        start = time.perf_counter()
        async with self._get_client() as client:
            resp = await client.get(self._api("/inbounds/list"))
            resp.raise_for_status()
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            return round(elapsed_ms, 1)

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

    async def restart_xray_service(self) -> bool:
        """Restarts the Xray core service on target panel."""
        endpoints = [
            self._api("/server/restartXrayService"),
            f"{self.base_url}{self.path_prefix}/server/restartXrayService",
            f"{self.base_url}/server/restartXrayService"
        ]
        return await self._try_post_endpoints(endpoints, "Restart Xray")

    async def stop_xray_service(self) -> bool:
        """Stops the Xray core service on target panel."""
        endpoints = [
            self._api("/server/stopXrayService"),
            f"{self.base_url}{self.path_prefix}/server/stopXrayService",
            f"{self.base_url}/server/stopXrayService"
        ]
        return await self._try_post_endpoints(endpoints, "Stop Xray")

    async def start_xray_service(self) -> bool:
        """Starts the Xray core service on target panel."""
        endpoints = [
            self._api("/server/startXrayService"),
            f"{self.base_url}{self.path_prefix}/server/startXrayService",
            f"{self.base_url}/server/startXrayService"
        ]
        return await self._try_post_endpoints(endpoints, "Start Xray")

    async def reset_all_traffics(self) -> bool:
        """Resets all inbounds traffic counters on target panel."""
        endpoints = [
            self._api("/inbounds/resetAllTraffics"),
            f"{self.base_url}{self.path_prefix}/inbounds/resetAllTraffics",
            f"{self.base_url}/inbounds/resetAllTraffics"
        ]
        return await self._try_post_endpoints(endpoints, "Reset All Traffics")

    async def reset_inbound_traffics(self, inbound_id: int) -> bool:
        """Resets traffic for a specific inbound."""
        endpoints = [
            self._api(f"/inbounds/resetAllClientTraffics/{inbound_id}"),
            f"{self.base_url}{self.path_prefix}/inbounds/resetAllClientTraffics/{inbound_id}",
            f"{self.base_url}/inbounds/resetAllClientTraffics/{inbound_id}"
        ]
        return await self._try_post_endpoints(endpoints, f"Reset Inbound {inbound_id} Traffic")

    async def _try_post_endpoints(self, endpoints: List[str], action_desc: str) -> bool:
        async with self._get_client() as client:
            last_err = None
            for ep in endpoints:
                try:
                    resp = await client.post(ep)
                    if resp.status_code in (200, 204):
                        data = resp.json() if resp.text else {}
                        if data.get("success", True):
                            return True
                except Exception as e:
                    last_err = e
            if last_err:
                raise ValueError(f"{action_desc} failed: {str(last_err)}")
            return True

    async def custom_api_request(self, method: str, endpoint: str, payload: Optional[Any] = None) -> Any:
        """Executes a custom API request to 3X-UI."""
        ep = endpoint.strip()
        if not ep.startswith("http"):
            if not ep.startswith("/"):
                ep = "/" + ep
            url = f"{self.base_url}{self.path_prefix}{ep}" if not ep.startswith("/api") else f"{self.base_url}{ep}"
        else:
            url = ep

        async with self._get_client() as client:
            m = method.strip().upper()
            if m == "GET":
                resp = await client.get(url, params=payload if isinstance(payload, dict) else None)
            elif m == "POST":
                resp = await client.post(url, json=payload if payload else None)
            elif m == "PUT":
                resp = await client.put(url, json=payload if payload else None)
            elif m == "DELETE":
                resp = await client.delete(url)
            else:
                resp = await client.request(m, url, json=payload if payload else None)

            resp.raise_for_status()
            try:
                return resp.json()
            except Exception:
                return {"text": resp.text, "status_code": resp.status_code}
