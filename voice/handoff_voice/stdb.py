"""SpacetimeDB over its HTTP API: reducer calls and SQL reads. Python has no SpacetimeDB SDK."""
from typing import Any

import httpx
from loguru import logger


def _decode(value: Any, ty: dict) -> Any:
    if "Sum" in ty:
        variants = ty["Sum"]["variants"]
        names = [v["name"].get("some") for v in variants]
        tag, inner = value
        if names == ["some", "none"]:
            return None if tag == 1 else _decode(inner, variants[0]["algebraic_type"])
        return names[tag]
    if "Product" in ty:
        elements = ty["Product"]["elements"]
        if len(elements) == 1 and str(elements[0]["name"].get("some", "")).startswith("__"):
            return value[0]  # timestamp / duration wrappers
        return {e["name"]["some"]: _decode(v, e["algebraic_type"]) for e, v in zip(elements, value)}
    if "Array" in ty:
        return [_decode(v, ty["Array"]) for v in value]
    return value


class Stdb:
    def __init__(self, host: str, db: str):
        self.host = host
        self.base = f"{host}/v1/database/{db}"
        self.client = httpx.AsyncClient(timeout=5)
        self.token: str | None = None
        if "maincloud" in host:
            logger.warning("Voice worker is pointed at Maincloud. Use handoff-local for development.")

    async def _headers(self) -> dict:
        if not self.token:
            r = await self.client.post(f"{self.host}/v1/identity")
            r.raise_for_status()
            self.token = r.json()["token"]
        return {"Authorization": f"Bearer {self.token}"}

    async def call(self, reducer: str, *args: Any) -> bool:
        try:
            r = await self.client.post(f"{self.base}/call/{reducer}", headers=await self._headers(), json=list(args))
        except httpx.HTTPError as e:
            logger.warning(f"{reducer} failed: {e}")
            return False
        if r.status_code >= 300:
            logger.warning(f"{reducer} -> {r.status_code} {r.text[:200]}")
            return False
        return True

    async def sql(self, query: str) -> list[dict]:
        r = await self.client.post(f"{self.base}/sql", headers=await self._headers(), content=query)
        r.raise_for_status()
        out = r.json()[-1]
        elements = out["schema"]["elements"]
        return [
            {e["name"]["some"]: _decode(v, e["algebraic_type"]) for e, v in zip(elements, row)}
            for row in out["rows"]
        ]

    async def step(self, workflow: str, tool: str, summary: str) -> None:
        logger.info(f"[{workflow}] {tool + ': ' if tool else ''}{summary}")
        await self.call("log_agent_step", workflow, tool, summary[:300])
