"""VisionSampler: about one frame a second from the bodycam's video to a Nemotron vision model (spec §19 Vision).

Sits right after transport.input(). It consumes the WebRTC video frames (they go no further down the pipeline),
sends one JPEG at a time to the model, keeps findings at confidence >= VISION_MIN_CONFIDENCE, saves the frame as
evidence, and posts each finding to the brain (POST {brain}/seen, voice/README.md "Local API"). The brain owns
the database: an ID card becomes the W6 search, a drug being given becomes log_event(med_<drug>, source "seen")
and the RB9/RB10 checks, AED pads / airway / IV-IO become procedure rows.

"Handoff, look" (or just "look") in the medic's words grabs a frame at once and speaks what was found through
the brain's queue, so the §15 spacing still applies. Without WebRTC video (the phone page is streaming to the
Pi hub only) it falls back to the hub's newest frame, GET {HUB_URL}/frame.jpg, when HUB_URL is set.

Ported from Devin's PR #6 (voice/handoff_voice/vision.py), which ran the same prompt on a self-hosted Omni; here
the model is NVIDIA-hosted on the same nvapi- key as the rest of the worker.
"""

import asyncio
import base64
import io
import json
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

import aiohttp
from loguru import logger
from PIL import Image

from pipecat.frames.frames import CancelFrame, EndFrame, Frame, InputImageRawFrame, StartFrame, TranscriptionFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

PROMPT = """You see one frame from a paramedic's bodycam. Report only what is clearly visible. Return JSON only:
{"findings": [ ... ]} where each finding is one of
{"type": "id_card", "name": "<name exactly as printed>", "birth_date": "YYYY-MM-DD", "confidence": 0-1}
{"type": "medication", "drug": "<generic name, lowercase>", "dose": "<as printed, or empty>", "being_given": true|false, "confidence": 0-1}
{"type": "aed_pads", "confidence": 0-1}
{"type": "airway_device", "confidence": 0-1}
{"type": "iv_io", "confidence": 0-1}
If nothing relevant is visible, return {"findings": []}. Never guess text you cannot read."""

# B6: the shortcut is "Handoff, look". A bare "look" ("look at his pupils") must not trigger a camera check.
LOOK = re.compile(r"\bhand\s?-?\s?off,?\s+look\b", re.I)
# How long the same finding is not reported again (the card stays in view; the syringe stays in the hand).
# Medications: 20 s, the §18 merge window with DEMO TIMING, so a second epi 45 s later is a new event.
FRESH_S = {"id_card": 60.0, "medication": 20.0, "aed_pads": 600.0, "airway_device": 600.0, "iv_io": 600.0}
# Frames are kept only where the frame is the evidence (who the patient is, what dose was given). Procedure
# findings are traced without the picture (§24.3: no faces of bystanders in saved frames).
KEEP_FRAME = {"id_card", "medication"}
SPOKEN = {"aed_pads": "AED pads on.", "airway_device": "Airway device in place.", "iv_io": "I-V or I-O access in place."}


@dataclass
class VisionConfig:
    api_key: str
    model: str
    base_url: str = "https://integrate.api.nvidia.com/v1"
    brain_url: str = "http://127.0.0.1:8787"
    interval_s: float = 1.0
    min_confidence: float = 0.7
    evidence_dir: Path = field(default_factory=lambda: Path(__file__).resolve().parent / "evidence")
    hub_url: str = ""
    # Omni models reason by default; this asks for a plain answer. Sent only when it is not empty.
    extra_body: dict = field(default_factory=lambda: {"chat_template_kwargs": {"enable_thinking": False}})
    timeout_s: float = 12.0


def to_jpeg(frame: InputImageRawFrame, max_width: int = 960) -> bytes:
    img = Image.frombytes(frame.format or "RGB", frame.size, frame.image).convert("RGB")
    if img.width > max_width:
        img = img.resize((max_width, round(img.height * max_width / img.width)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=70)
    return buf.getvalue()


def parse_findings(content: str) -> list[dict]:
    """The model's text → the findings list. Tolerates code fences, prose around the JSON, and a repeated object
    (the hosted Omni answered the same JSON twice, once plain and once fenced)."""
    text = content.strip()
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON in the reply")
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                data = json.loads(text[start : i + 1])
                findings = data.get("findings", []) if isinstance(data, dict) else []
                return [f for f in findings if isinstance(f, dict)]
    raise ValueError("unbalanced JSON in the reply")


def to_seen(f: dict) -> dict | None:
    """One model finding → the body of POST /seen, or None when it is not something the brain acts on."""
    kind = f.get("type")
    conf = float(f.get("confidence") or 0)
    if kind == "id_card":
        name, dob = str(f.get("name") or "").strip(), str(f.get("birth_date") or "").strip()
        if not name or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dob):
            return None
        return {"type": "id_card", "name": name, "birthDate": dob, "confidence": conf}
    if kind == "medication":
        drug = str(f.get("drug") or "").strip().lower()
        if not drug or not f.get("being_given"):
            return None  # a label in view is not a dose given (RB8: label AND the push)
        dose = str(f.get("dose") or "").strip()
        body = {"type": "medication", "drug": drug, "confidence": conf}
        if dose:
            body["dose"] = dose
        return body
    if kind in ("aed_pads", "airway_device", "iv_io"):
        return {"type": kind, "confidence": conf}
    return None


def dedupe_key(seen: dict) -> str:
    if seen["type"] == "id_card":
        return f"id:{seen['name'].lower()}:{seen['birthDate']}"
    if seen["type"] == "medication":
        return f"med:{seen['drug']}"
    return seen["type"]


class VisionSampler(FrameProcessor):
    def __init__(self, cfg: VisionConfig, **kwargs):
        super().__init__(**kwargs)
        self.cfg = cfg
        self._session: aiohttp.ClientSession | None = None
        self._busy = False
        self._force = False
        self._last_start = 0.0
        self._last_frame_at = 0.0
        self._reported: dict[str, float] = {}
        self._hub_task: asyncio.Task | None = None
        self.calls = 0
        self.failures = 0
        self.latencies_ms: list[float] = []
        self.findings = 0

    # ---- frames ---------------------------------------------------------------------------------------------

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, StartFrame):
            await self.push_frame(frame, direction)
            await self._start()
            return
        if isinstance(frame, (EndFrame, CancelFrame)):
            await self._stop()
            await self.push_frame(frame, direction)
            return
        if isinstance(frame, InputImageRawFrame):
            # Video stops here: nothing downstream wants it, and the audio path must not carry it. Input frames
            # are system frames in Pipecat (processed at once, concurrently), so claim the slot before encoding.
            self._last_frame_at = time.time()
            if self._due():
                self._begin(frame)
            return
        if isinstance(frame, TranscriptionFrame) and LOOK.search(frame.text or ""):
            self.look()
        await self.push_frame(frame, direction)

    def look(self) -> None:
        """B6: "Handoff, look" grabs the next frame at once and speaks the result."""
        logger.info("look: grabbing the next frame")
        self._force = True

    # ---- sampling -------------------------------------------------------------------------------------------

    def _due(self) -> bool:
        if self._busy:
            return False  # skip frames while a call is running, so vision never falls behind (§19)
        return self._force or time.time() - self._last_start >= self.cfg.interval_s

    def _begin(self, source: InputImageRawFrame | bytes) -> None:
        """Claim the one-call-at-a-time slot now; encode (if needed) and call the model in a task."""
        forced, self._force = self._force, False
        self._busy, self._last_start = True, time.time()
        self.create_task(self._encode_and_analyze(source, forced), name="vision_call")

    async def _encode_and_analyze(self, source: InputImageRawFrame | bytes, forced: bool) -> None:
        try:
            jpg = source if isinstance(source, bytes) else await asyncio.to_thread(to_jpeg, source)
        except Exception as e:
            logger.warning(f"could not encode the video frame: {e!r}")
            self._busy = False
            return
        await self._analyze(jpg, forced)

    async def _start(self):
        if self._session:
            return
        self._session = aiohttp.ClientSession()
        if self.cfg.hub_url and not self._hub_task:
            self._hub_task = self.create_task(self._hub_loop(), name="vision_hub")

    async def _stop(self):
        task, self._hub_task = self._hub_task, None
        if task and not task.done():
            await self.cancel_task(task)
        if self._session:
            await self._session.close()
            self._session = None

    async def _hub_loop(self):
        """No WebRTC video for 3 s: use the Pi hub's newest camera frame instead (the phone page already uploads
        them at 10 fps). Long-polls /frame.jpg?after=<seq>; 204 means nothing new."""
        assert self._session
        seq = 0
        while True:
            await asyncio.sleep(0.2)
            if time.time() - self._last_frame_at < 3 or not self._due():
                continue
            try:
                async with self._session.get(
                    f"{self.cfg.hub_url}/frame.jpg", params={"after": seq}, timeout=aiohttp.ClientTimeout(total=8)
                ) as r:
                    if r.status == 200:
                        jpg = await r.read()
                        seq = int(r.headers.get("X-Seq", seq))
                        if jpg[:2] == b"\xff\xd8":
                            self._begin(jpg)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.debug(f"hub frame fetch failed: {e!r}")
                await asyncio.sleep(2)

    async def _analyze(self, jpg: bytes, forced: bool):
        t0 = time.time()
        findings: list[dict] | None
        try:
            findings = await self._ask_model(jpg)
        except Exception as e:
            self.failures += 1
            logger.warning(f"vision call failed: {e!r}")
            findings = None
        finally:
            ms = (time.time() - t0) * 1000
            self.calls += 1
            self.latencies_ms.append(ms)
            self._busy = False
        if findings is None:
            await self._trace("vision", f"model call failed ({self.failures} so far), {ms:.0f} ms" + (" on look" if forced else ""))
            if forced:
                await self._say("Camera check failed.")
            return
        kept = [f for f in findings if float(f.get("confidence") or 0) >= self.cfg.min_confidence]
        logger.info(f"vision: {len(findings)} finding(s), {len(kept)} kept, {ms:.0f} ms" + (" (look)" if forced else ""))
        if findings or forced:
            # §19: every step in the trace. Quiet frames (no findings, not asked) are not worth a row a second.
            dropped = [f"{f.get('type')} {float(f.get('confidence') or 0):.2f}" for f in findings if f not in kept]
            await self._trace("vision", f"{'look: ' if forced else ''}{len(kept)} finding(s) kept of {len(findings)}, {ms:.0f} ms"
                              + (f"; under {self.cfg.min_confidence:g}: {', '.join(dropped)}" if dropped else ""))
        spoken: list[str] = []
        for f in kept:
            seen = to_seen(f)
            if seen is None:
                if forced and f.get("type") == "medication":
                    spoken.append(f"{str(f.get('drug') or 'a drug').capitalize()} label in view.")
                elif forced and f.get("type") == "id_card":
                    spoken.append("An ID card, but I can't read the name and birth date.")
                continue
            key = dedupe_key(seen)
            if not forced and not self._fresh(seen["type"], key):
                continue
            self._reported[key] = time.time()
            seen["detail"] = self._save_evidence(jpg, seen) if seen["type"] in KEEP_FRAME else "vision (frame not kept)"
            self.findings += 1
            if await self._post_seen(seen) and forced:
                if seen["type"] == "id_card":
                    spoken.append(f"ID card: {seen['name'].title() if seen['name'].isupper() else seen['name']}.")
                elif seen["type"] == "medication":
                    spoken.append(f"{seen['drug'].capitalize()} being given.")
                else:
                    spoken.append(SPOKEN[seen["type"]])
        if forced:
            # The ID card's answer is the record summary the brain speaks; for everything else say what was seen.
            if not any(f.get("type") == "id_card" and to_seen(f) for f in kept):
                await self._say(" ".join(spoken) if spoken else "Nothing I recognise.")

    def _fresh(self, kind: str, key: str) -> bool:
        return time.time() - self._reported.get(key, 0.0) >= FRESH_S.get(kind, 60.0)

    def _save_evidence(self, jpg: bytes, seen: dict) -> str:
        """Keep the frame for the H4 chips and the report; returns a short path for the event's source detail."""
        try:
            self.cfg.evidence_dir.mkdir(parents=True, exist_ok=True)
            name = seen["type"] if seen["type"] != "medication" else seen["drug"].replace(" ", "_")
            path = self.cfg.evidence_dir / f"{int(time.time() * 1000)}-{name}.jpg"
            path.write_bytes(jpg)
            return f"vision frame {path.name}"
        except OSError as e:
            logger.warning(f"could not save the evidence frame: {e!r}")
            return "vision frame (not saved)"

    # ---- the model and the brain ----------------------------------------------------------------------------

    async def _ask_model(self, jpg: bytes) -> list[dict]:
        assert self._session
        body = {
            "model": self.cfg.model,
            "temperature": 0,
            "max_tokens": 200,
            "messages": [
                {"role": "system", "content": PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpg).decode()}},
                        {"type": "text", "text": "Findings JSON."},
                    ],
                },
            ],
            **self.cfg.extra_body,
        }
        async with self._session.post(
            f"{self.cfg.base_url}/chat/completions",
            json=body,
            headers={"Authorization": f"Bearer {self.cfg.api_key}", "Accept": "application/json"},
            timeout=aiohttp.ClientTimeout(total=self.cfg.timeout_s),
        ) as r:
            if r.status >= 300:
                raise RuntimeError(f"{r.status} {(await r.text())[:160]}")
            data = await r.json()
        content = data["choices"][0]["message"].get("content") or ""
        return parse_findings(content)

    async def _post_seen(self, seen: dict) -> bool:
        assert self._session
        try:
            async with self._session.post(
                f"{self.cfg.brain_url}/seen", json=seen, timeout=aiohttp.ClientTimeout(total=2)
            ) as r:
                if r.status >= 300:
                    logger.warning(f"brain answered {r.status} to /seen: {(await r.text())[:120]}")
                    return False
                return True
        except Exception as e:
            logger.warning(f"POST /seen failed ({e!r}); dropped {seen}")
            return False

    async def _trace(self, tool: str, summary: str) -> None:
        """A row in agent_step (workflow voice) through the brain, so the sampler's decisions are on the record."""
        assert self._session
        try:
            async with self._session.post(
                f"{self.cfg.brain_url}/trace", json={"tool": tool, "summary": summary[:300]}, timeout=aiohttp.ClientTimeout(total=2)
            ) as r:
                if r.status >= 300:
                    logger.debug(f"brain answered {r.status} to /trace")
        except Exception as e:
            logger.debug(f"POST /trace failed ({e!r})")

    async def _say(self, text: str) -> None:
        """Speak through the brain, so the words go through its policy and the shared callout queue."""
        assert self._session
        try:
            async with self._session.post(
                f"{self.cfg.brain_url}/say", json={"text": text, "priority": 2, "kind": "vision"}, timeout=aiohttp.ClientTimeout(total=2)
            ) as r:
                if r.status >= 300:
                    logger.warning(f"brain answered {r.status} to /say")
        except Exception as e:
            logger.warning(f"POST /say failed ({e!r}); not spoken: {text!r}")
