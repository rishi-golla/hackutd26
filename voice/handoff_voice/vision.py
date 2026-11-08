"""~1 frame/s from the live video to Nemotron Omni; findings become SpacetimeDB rows (spec §19 Vision)."""
import asyncio
import base64
import io
import json
import os
import re
import time

import httpx
from loguru import logger
from PIL import Image
from pipecat.frames.frames import Frame, InputImageRawFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from . import clinical, config
from .stdb import Stdb

WF = "Vision"
PROMPT = """You see one frame from a paramedic's bodycam. Report only what is clearly visible. Return JSON only:
{"findings": [ ... ]} where each finding is one of
{"type": "id_card", "name": "<name exactly as printed>", "birth_date": "YYYY-MM-DD", "confidence": 0-1}
{"type": "medication", "drug": "<generic name, lowercase>", "dose": "<as printed, or empty>", "being_given": true|false, "confidence": 0-1}
{"type": "aed_pads", "confidence": 0-1}
{"type": "airway_device", "confidence": 0-1}
{"type": "iv_io", "confidence": 0-1}
If nothing relevant is visible, return {"findings": []}. Never guess text you cannot read."""

LABELS = {"aed_pads": ("procedure", "AED pads on"), "airway_device": ("airway", "Airway device"), "iv_io": ("procedure", "IV/IO in place")}


def _person(name: str) -> str:
    if "," in name:  # "AVERY, JORDAN" -> "Jordan Avery"
        last, first = [p.strip() for p in name.split(",", 1)]
        name = f"{first} {last}"
    return " ".join(w.capitalize() for w in name.split())


def _jpeg(frame: InputImageRawFrame) -> bytes:
    img = Image.frombytes(frame.format or "RGB", frame.size, frame.image).convert("RGB")
    if img.width > 960:
        img = img.resize((960, round(img.height * 960 / img.width)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=70)
    return buf.getvalue()


class VisionSampler(FrameProcessor):
    """Sits right after transport.input(). Consumes video frames; never forwards them."""

    def __init__(self, stdb: Stdb, state, tools, say):
        super().__init__()
        self.stdb, self.state, self.tools, self._say = stdb, state, tools, say
        self.client = httpx.AsyncClient(timeout=10)
        self._busy = False
        self._last_start = 0.0
        self._last_frame_at = 0.0
        self._force = False
        self._seen: dict[str, float] = {}
        self._hub_task: asyncio.Task | None = None
        self.calls = 0
        self.latencies: list[float] = []

    def look(self) -> None:
        self._force = True

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InputImageRawFrame):
            self._last_frame_at = time.time()
            if self._due():
                self._start(await asyncio.to_thread(_jpeg, frame))
            return
        await self.push_frame(frame, direction)
        if config.HUB_URL and not self._hub_task:
            self._hub_task = asyncio.create_task(self._hub_loop())

    def _due(self) -> bool:
        return not self._busy and (self._force or time.time() - self._last_start >= config.VISION_INTERVAL_S)

    def _start(self, jpg: bytes) -> None:
        forced, self._force = self._force, False
        self._busy, self._last_start = True, time.time()
        asyncio.create_task(self._analyze(jpg, forced))

    async def _hub_loop(self) -> None:
        """Fallback when no WebRTC video arrives: the Pi hub's newest camera frame."""
        seq = 0
        while True:
            await asyncio.sleep(0.2)
            if time.time() - self._last_frame_at < 3 or not self._due():
                continue
            try:
                r = await self.client.get(f"{config.HUB_URL}/frame.jpg", params={"after": seq}, timeout=6)
                if r.status_code == 200 and r.content:
                    seq = int(r.headers.get("X-Seq", seq))
                    self._start(r.content)
            except httpx.HTTPError:
                await asyncio.sleep(2)

    async def _analyze(self, jpg: bytes, forced: bool) -> None:
        t0 = time.time()
        try:
            body = {
                "model": config.OMNI_MODEL, "temperature": 0, "max_tokens": 200,
                "response_format": {"type": "json_object"},
                "chat_template_kwargs": {"enable_thinking": False},
                "messages": [
                    {"role": "system", "content": PROMPT},
                    {"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpg).decode()}},
                        {"type": "text", "text": "Findings JSON."}]},
                ],
            }
            r = await self.client.post(f"{config.OMNI_BASE_URL}/chat/completions", json=body,
                                       headers={"Authorization": f"Bearer {config.OMNI_API_KEY}"})
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"] or "{}"
            findings = json.loads(re.sub(r"^```(?:json)?|```$", "", content.strip())).get("findings", [])
        except Exception as e:
            logger.warning(f"vision call failed: {e}")
            findings = None
        finally:
            ms = (time.time() - t0) * 1000
            self.calls += 1
            self.latencies.append(ms)
            self._busy = False
        if findings is None:
            if forced:
                await self._say("Camera check failed.", "vision")
            return
        kept = [f for f in findings if isinstance(f, dict) and float(f.get("confidence") or 0) >= config.VISION_MIN_CONFIDENCE]
        if forced:
            await self.stdb.step(WF, "look", f"{len(kept)} finding(s) in {ms:.0f} ms")
        spoken = []
        for f in kept:
            line = await self._handle(f, jpg, forced)
            if line:
                spoken.append(line)
        if forced:
            await self._say(" ".join(spoken) if spoken else "Nothing I recognise.", "vision")

    def _fresh(self, key: str, window_s: float = 60) -> bool:
        now = time.time()
        if now - self._seen.get(key, 0) < window_s:
            return False
        self._seen[key] = now
        return True

    def _evidence(self, jpg: bytes, kind: str) -> str:
        os.makedirs(config.EVIDENCE_DIR, exist_ok=True)
        path = os.path.join(config.EVIDENCE_DIR, f"{int(time.time() * 1000)}-{kind}.jpg")
        with open(path, "wb") as fh:
            fh.write(jpg)
        return path

    async def _handle(self, f: dict, jpg: bytes, forced: bool) -> str | None:
        kind, conf = f.get("type"), float(f.get("confidence") or 0)
        if kind == "id_card":
            name, dob = _person(str(f.get("name") or "")), str(f.get("birth_date") or "")
            if not name or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dob):
                return "ID card, but I can't read the name and birth date." if forced else None
            if not self._fresh(f"id:{name}:{dob}") and not forced:
                return None
            self.tools.grounding.add(f"ID card: {name}, born {dob}")
            await self.stdb.step(WF, "id_card", f"{name}, {dob} (confidence {conf:.2f}) → {self._evidence(jpg, 'id')}")
            result = await self.tools.search(name, dob, "ID card")
            await self.stdb.step(WF, "search_ehr", f"name={name}, birth_date={dob} → {result}")
            return f"ID card: {name}." if forced else None
        if kind == "medication":
            drug = clinical.normalize_drug(str(f.get("drug") or ""))
            if not drug:
                return None
            dose = str(f.get("dose") or "").strip()
            if not f.get("being_given"):
                return f"{drug} label." if forced else None
            if not self._fresh(f"med:{drug}"):
                return None
            label = f"{drug.capitalize()} {dose}".strip() + " (seen)"
            path = self._evidence(jpg, drug)
            await self.stdb.call("log_event", f"med_{drug}", label, "seen", f"vision frame {path}")
            await self.stdb.step(WF, "log_event", f"med_{drug} {label} (confidence {conf:.2f})")
            return f"{drug} being given." if forced else None
        if kind in LABELS:
            ev_kind, label = LABELS[kind]
            if self._fresh(kind, 600):
                await self.stdb.call("log_event", ev_kind, label + " (seen)", "seen", f"vision frame {self._evidence(jpg, kind)}")
                await self.stdb.step(WF, "log_event", f"{label} (confidence {conf:.2f})")
            return f"{label}." if forced else None
        return None
