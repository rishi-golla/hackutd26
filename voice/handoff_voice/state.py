"""Compact incident state from SpacetimeDB, refreshed once a second, plus new-row notifications."""
import asyncio
import time
from typing import Awaitable, Callable

from loguru import logger

from .stdb import Stdb

Listener = Callable[[str, dict], Awaitable[None]]


def _now_us() -> int:
    return int(time.time() * 1_000_000)


def _ago_s(ts: int | None) -> float | None:
    return None if ts is None else (_now_us() - ts) / 1_000_000


class StateWatcher:
    def __init__(self, stdb: Stdb, interval_s: float = 1.0):
        self.stdb = stdb
        self.interval_s = interval_s
        self.incident: dict | None = None
        self.vitals: dict | None = None
        self.cpr: dict | None = None
        self.timers: list[dict] = []
        self.events: list[dict] = []
        self.record: dict | None = None
        self.transcripts: list[dict] = []
        self._cursor: dict[str, int] = {}
        self._listeners: list[Listener] = []
        self._task: asyncio.Task | None = None

    def subscribe(self, fn: Listener) -> Callable[[], None]:
        self._listeners.append(fn)
        return lambda: self._listeners.remove(fn) if fn in self._listeners else None

    def start(self) -> None:
        if not self._task:
            self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        while True:
            try:
                await self.refresh()
            except Exception as e:  # keep polling through a DB restart
                logger.warning(f"state refresh failed: {e}")
            await asyncio.sleep(self.interval_s)

    async def _emit(self, kind: str, row: dict) -> None:
        for fn in list(self._listeners):
            try:
                await fn(kind, row)
            except Exception as e:
                logger.exception(f"listener for {kind} failed: {e}")

    async def _new_rows(self, table: str, incident_id: int, first: bool) -> list[dict]:
        cursor = self._cursor.get(table)
        after = "" if cursor is None else f" AND id > {cursor}"  # ids are u64: no negative literals
        rows = await self.stdb.sql(f"SELECT * FROM {table} WHERE incident_id = {incident_id}{after}")
        rows.sort(key=lambda r: r["id"])
        if rows:
            self._cursor[table] = rows[-1]["id"]
        return [] if first else rows

    async def refresh(self) -> None:
        incidents = [i for i in await self.stdb.sql("SELECT * FROM incident") if i["status"] != "closed"]
        active = max(incidents, key=lambda i: i["id"], default=None)
        first = active is not None and (self.incident is None or self.incident["id"] != active["id"])
        if first:
            self._cursor = {}
            self.events, self.transcripts, self.vitals = [], [], None
        self.incident = active
        if not active:
            return
        iid = active["id"]

        vitals = await self._new_rows("vitals", iid, False)
        if vitals:
            self.vitals = vitals[-1]
        for e in await self._new_rows("event", iid, first):
            self.events.append(e)
            await self._emit("event", e)
        if first:  # keep the recent history for the summary without re-announcing it
            self.events = sorted(await self.stdb.sql(f"SELECT * FROM event WHERE incident_id = {iid}"), key=lambda r: r["id"])
        self.events = self.events[-20:]
        for t in await self._new_rows("transcript", iid, False):
            self.transcripts.append(t)
        self.transcripts = self.transcripts[-12:]
        for c in await self._new_rows("callout", iid, first):
            await self._emit("callout", c)

        cpr = await self.stdb.sql(f"SELECT * FROM cpr_state WHERE incident_id = {iid}")
        self.cpr = cpr[0] if cpr else None
        self.timers = await self.stdb.sql(f"SELECT * FROM timer WHERE incident_id = {iid}")
        rec = await self.stdb.sql(f"SELECT * FROM patient_record WHERE incident_id = {iid}")
        self.record = rec[0] if rec else None

    def recent_text(self) -> str:
        return " ".join(t["text"] for t in self.transcripts)

    def summary(self) -> str:
        inc = self.incident
        if not inc:
            return "No active incident."
        out: list[str] = [f"Status: {inc['status']}."]
        arrest = _ago_s(inc.get("arrest_started_at"))
        if arrest is not None and inc["status"] == "arrest":
            out.append(f"Arrest started {int(arrest // 60)} min {int(arrest % 60)} s ago.")
        v = self.vitals
        age = _ago_s(v["ts"]) if v else None
        if v and age is not None and age < 10:
            label = "simulated" if v.get("simulated") else "experimental"
            parts = []
            if v.get("hr") is not None:
                parts.append(f"HR {v['hr']}")
            if v.get("spo_2") is not None:
                parts.append(f"SpO2 {v['spo_2']}% ({label})")
            out.append(", ".join(parts) + f", {int(age)} s old." if parts else "No vitals.")
        else:
            out.append("No live vitals.")
        c = self.cpr
        if c and inc["status"] == "arrest":
            out.append(
                f"CPR {'paused' if c.get('paused') else 'compressing' if c.get('compressing') else 'not detected'}"
                + (f", rate {c['rate']}/min." if c.get("rate") else ".")
            )
        for t in self.timers:
            due = _ago_s(t.get("due_at"))
            if t.get("state") not in ("cancelled", "done", "fired") and due is not None and due > -900:
                out.append(f"{t['kind']} timer {'overdue by' if due > 0 else 'due in'} {abs(int(due))} s.")
        r = self.record
        if r:
            cached = " (cached copy)" if r.get("source") == "cached" else ""
            out.append(
                f"Patient: {r['name']}, born {r['birth_date']}{cached}. "
                f"Allergies: {', '.join(r['allergies']) or 'none recorded'}. "
                f"Medications: {', '.join(r['medications']) or 'none recorded'}. "
                f"Conditions: {', '.join(r['conditions']) or 'none recorded'}. Code status: {r['code_status']}."
            )
        else:
            out.append("Patient not identified.")
        if self.events:
            out.append("Recent events: " + "; ".join(e["label"] for e in self.events[-6:]) + ".")
        return " ".join(out)


