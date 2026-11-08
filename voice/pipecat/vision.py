"""VisionSampler: about one frame a second from the bodycam's video to a Nemotron vision model (spec §19 Vision).

Sits right after transport.input(). It consumes the WebRTC video frames (they go no further down the pipeline),
sends one JPEG at a time to the model, keeps findings at confidence >= VISION_MIN_CONFIDENCE, saves the frame as
evidence, and posts each finding to the brain (POST {brain}/seen, voice/README.md "Local API"). The brain owns
the database: an ID card becomes the W6 search, a drug being given becomes log_event(med_<drug>, source "seen")
and the RB9/RB10 checks, AED pads / airway / IV-IO become procedure rows.

The same reply carries a one-sentence "scene" (what is happening in view). It goes to the brain as
POST /seen {"type":"scene","text":...,"confidence":1}, which shows it to Nemotron as a "CAMERA (N s ago)" line, so
the video informs its decisions. A scene is posted only when it changed (case and spacing ignored) and at most every
SCENE_EVERY_S. It is never traced or spoken from here (the brain writes its own dashboard row), and it costs no
extra model call: it rides in the per-frame call.

"Handoff, look" in the medic's words grabs a frame at once and speaks what was found through the brain's queue,
so the §15 spacing still applies. Without WebRTC video for 3 s (the phone page is streaming to the Pi hub only) it
falls back to the hub's newest frame, GET {HUB_URL}/frame.jpg, when HUB_URL is set.

Budget: at most one model call in flight and at most one per interval_s; after a 429 the unasked sampling waits
(Retry-After, else MODEL_BUSY_HOLD_S). Lifecycle: everything the sampler starts (the hub loop, the in-flight call,
the HTTP session) is released on EndFrame/CancelFrame AND in cleanup(), and nothing new starts after that. The
second matters: a session cancelled before its StartFrame reached the end of the pipeline (a fast phone reconnect)
never gets the CancelFrame from Pipecat's worker, only cleanup(), and the base cleanup() leaves create_task() tasks
running. A leaked hub loop kept calling the model after its session ended; after a few reconnects several did at
once and the key hit 429s.

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
{"scene": "<one short sentence saying what is happening in view, e.g. 'medic's gloved hands over the patient's chest, syringe in the right hand'; empty if nothing is visible>", "findings": [ ... ]}
where each finding is one of
{"type": "id_card", "name": "<name exactly as printed>", "birth_date": "YYYY-MM-DD, or null when no complete date of birth is printed", "confidence": 0-1}
{"type": "medication", "drug": "<generic name, lowercase>", "dose": "<as printed, or empty>", "being_given": true|false, "confidence": 0-1}
{"type": "aed_pads", "confidence": 0-1}
{"type": "airway_device", "confidence": 0-1}
{"type": "iv_io", "confidence": 0-1}
The scene describes actions and equipment only: no names, no printed text, no one but the medic and the patient.
If nothing relevant is visible, the findings list is empty: {"scene": "...", "findings": []}. Never guess text you cannot read. Never infer a birth date from an age, an expiry or an issue date: if any part of the date of birth is not printed and readable, birth_date is null."""

# B6: the shortcut is "Handoff, look". A bare "look" ("look at his pupils") must not trigger a camera check.
LOOK = re.compile(r"\bhand\s?-?\s?off,?\s+look\b", re.I)
# How long the same finding is not reported again (the card stays in view; the syringe stays in the hand).
# Medications: 20 s, the §18 merge window with DEMO TIMING, so a second epi 45 s later is a new event.
FRESH_S = {"id_card": 60.0, "medication": 20.0, "aed_pads": 600.0, "airway_device": 600.0, "iv_io": 600.0}
# Frames are kept only where the frame is the evidence (who the patient is, what dose was given). Procedure
# findings are traced without the picture (§24.3: no faces of bystanders in saved frames).
KEEP_FRAME = {"id_card", "medication"}
SPOKEN = {"aed_pads": "AED pads on.", "airway_device": "Airway device in place.", "iv_io": "I-V or I-O access in place."}
# The scene sentence goes to the brain at most this often, and only when it changed.
SCENE_EVERY_S = 5.0
SCENE_MAX_CHARS = 160
# No WebRTC video for this long: the hub's frames are used instead (when HUB_URL is set).
HUB_FALLBACK_AFTER_S = 3.0
# After a 429 without Retry-After, unasked sampling pauses this long (the key is shared with ASR and TTS).
MODEL_BUSY_HOLD_S = 5.0
MODEL_BUSY_MAX_HOLD_S = 30.0


class ModelBusy(RuntimeError):
    """The vision endpoint answered 429; retry_after is how long to leave it alone."""

    def __init__(self, message: str, retry_after: float):
        super().__init__(message)
        self.retry_after = retry_after


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


def _reply_object(content: str) -> dict:
    """The JSON object in the model's text. Tolerates code fences, prose around the JSON, and a repeated object
    (the hosted Omni answered the same JSON twice, once plain and once fenced): the first object that has
    "findings" or "scene" wins, else the first object at all."""
    text = content.strip()
    decoder = json.JSONDecoder()
    first: dict | None = None
    found_brace = False
    for m in re.finditer(r"\{", text):
        found_brace = True
        try:
            data, _ = decoder.raw_decode(text, m.start())
        except ValueError:
            continue
        if not isinstance(data, dict):
            continue
        if "findings" in data or "scene" in data:
            return data
        if first is None:
            first = data
    if first is not None:
        return first
    raise ValueError("unbalanced JSON in the reply" if found_brace else "no JSON in the reply")


def clean_scene(value) -> str:
    """The model's scene → one line for the brain: no braces, at most SCENE_MAX_CHARS; empty when not a string."""
    if not isinstance(value, str):
        return ""
    text = " ".join(value.replace("{", " ").replace("}", " ").split())
    if len(text) > SCENE_MAX_CHARS:
        cut = text[: SCENE_MAX_CHARS - 1]
        text = (cut.rsplit(" ", 1)[0] if " " in cut else cut).rstrip(" ,;:") + "…"
    return text


def parse_reply(content: str) -> tuple[list[dict], str]:
    """The model's text → (findings, scene). The scene is "" when absent or not a string. Raises ValueError when
    the text holds no JSON object."""
    data = _reply_object(content)
    findings = data.get("findings", [])
    if not isinstance(findings, list):
        findings = []
    return [f for f in findings if isinstance(f, dict)], clean_scene(data.get("scene"))


def parse_findings(content: str) -> list[dict]:
    """The model's text → the findings list (see parse_reply)."""
    return parse_reply(content)[0]


def scene_key(scene: str) -> str:
    """Two scenes are the same when they differ only in case and spacing."""
    return " ".join(scene.lower().split())


def to_seen(f: dict) -> dict | None:
    """One model finding → the body of POST /seen, or None when it is not something the brain acts on."""
    kind = f.get("type")
    conf = float(f.get("confidence") or 0)
    if kind == "id_card":
        name, dob = str(f.get("name") or "").strip(), str(f.get("birth_date") or "").strip()
        if len(name) < 3:
            return None
        body = {"type": "id_card", "name": name, "confidence": conf}
        # A date that isn't a complete ISO date is no date: the card is reported without one, never with a guess
        # (live Sun ~09:07: a card with no date of birth came back with an invented one).
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", dob):
            body["birthDate"] = dob
        return body
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
        return f"id:{seen['name'].lower()}:{seen.get('birthDate', '')}"
    if seen["type"] == "medication":
        return f"med:{seen['drug']}"
    return seen["type"]


class VisionSampler(FrameProcessor):
    def __init__(self, cfg: VisionConfig, **kwargs):
        super().__init__(**kwargs)
        self.cfg = cfg
        self._session: aiohttp.ClientSession | None = None
        self._stopped = False  # set once, on EndFrame/CancelFrame or cleanup(): nothing new starts after it
        self._busy = False
        self._force = False
        self._last_start = 0.0
        self._last_frame_at = 0.0
        self._hold_until = 0.0  # after a 429: no unasked call before this
        self._reported: dict[str, float] = {}
        self._last_scene = ""  # scene_key() of the last scene the brain took
        self._last_scene_at = 0.0
        self._hub_task: asyncio.Task | None = None
        self._calls: set[asyncio.Task] = set()  # in-flight vision_call tasks (at most one; see _due)
        self.calls = 0
        self.failures = 0
        self.latencies_ms: list[float] = []
        self.findings = 0
        self.scenes = 0
        self.hub_fetches = 0

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
        if self._stopped or not self._session:
            return False
        if self._busy:
            return False  # skip frames while a call is running, so vision never falls behind (§19)
        if self._force:
            return True
        now = time.time()
        return now >= self._hold_until and now - self._last_start >= self.cfg.interval_s

    def _begin(self, source: InputImageRawFrame | bytes) -> None:
        """Claim the one-call-at-a-time slot now; encode (if needed) and call the model in a task."""
        if self._stopped or not self._session:
            return
        forced, self._force = self._force, False
        self._busy, self._last_start = True, time.time()
        task = self.create_task(self._encode_and_analyze(source, forced), name="vision_call")
        self._calls.add(task)
        task.add_done_callback(self._calls.discard)

    async def _encode_and_analyze(self, source: InputImageRawFrame | bytes, forced: bool) -> None:
        try:
            jpg = source if isinstance(source, bytes) else await asyncio.to_thread(to_jpeg, source)
        except Exception as e:
            logger.warning(f"could not encode the video frame: {e!r}")
            self._busy = False
            return
        await self._analyze(jpg, forced)

    async def _start(self):
        if self._session or self._stopped:
            return
        self._session = aiohttp.ClientSession()
        if self.cfg.hub_url and not self._hub_task:
            self._hub_task = self.create_task(self._hub_loop(), name="vision_hub")

    async def _stop(self):
        """Release everything this sampler started. Idempotent, and safe to run from process_frame and cleanup()
        at the same time: cancellation of every task is requested before the first await, so being interrupted
        while waiting for them cannot leave one running."""
        self._stopped = True
        current = asyncio.current_task()
        tasks = [t for t in (self._hub_task, *self._calls) if t and not t.done() and t is not current]
        self._hub_task = None
        self._calls.clear()
        self._busy = False
        for task in tasks:
            task.cancel()
        for task in tasks:
            await self.cancel_task(task)
        session, self._session = self._session, None
        if session and not session.closed:
            await session.close()

    async def cleanup(self):
        """Pipecat's base cleanup() releases only the processor's own frame tasks; the hub loop, the in-flight
        model call and the HTTP session are released here. This is the only teardown a session cancelled before
        it finished starting gets (the worker then never pushes a CancelFrame)."""
        await self._stop()
        await super().cleanup()

    async def _hub_loop(self):
        """No WebRTC video for HUB_FALLBACK_AFTER_S: use the Pi hub's newest camera frame instead (the phone page
        already uploads them at 10 fps). Long-polls /frame.jpg?after=<seq>; 204 means nothing new. Never fetches
        while WebRTC video is arriving, and ends as soon as the sampler stops."""
        seq = 0
        while not self._stopped:
            await asyncio.sleep(0.2)
            session = self._session
            if self._stopped or session is None:
                return
            if time.time() - self._last_frame_at < HUB_FALLBACK_AFTER_S or not self._due():
                continue
            try:
                self.hub_fetches += 1
                async with session.get(
                    f"{self.cfg.hub_url}/frame.jpg", params={"after": seq}, timeout=aiohttp.ClientTimeout(total=8)
                ) as r:
                    if r.status == 200:
                        jpg = await r.read()
                        seq = int(r.headers.get("X-Seq", seq))
                        # WebRTC video may have started while the long-poll waited: it wins.
                        if jpg[:2] == b"\xff\xd8" and time.time() - self._last_frame_at >= HUB_FALLBACK_AFTER_S and self._due():
                            self._begin(jpg)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                if self._stopped:
                    return
                logger.debug(f"hub frame fetch failed: {e!r}")
                await asyncio.sleep(2)

    async def _analyze(self, jpg: bytes, forced: bool):
        t0 = time.time()
        findings: list[dict] | None
        scene = ""
        try:
            findings, scene = await self._ask_model(jpg)
        except Exception as e:
            findings = None
            if not self._stopped:
                self.failures += 1
                if isinstance(e, ModelBusy):
                    self._hold_until = time.time() + e.retry_after
                    logger.warning(f"vision model busy (429); pausing unasked frames for {e.retry_after:g} s")
                else:
                    logger.warning(f"vision call failed: {e!r}")
        finally:
            ms = (time.time() - t0) * 1000
            self.calls += 1
            self.latencies_ms.append(ms)
            self._busy = False
        if self._stopped:
            return  # the session ended while the model was answering: nothing goes to the brain
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
        await self._maybe_post_scene(scene)

    async def _maybe_post_scene(self, scene: str) -> None:
        """The scene to the brain (POST /seen type "scene"): only a changed one, at most every SCENE_EVERY_S.
        Not traced (the brain writes the dashboard row) and never spoken."""
        if not scene or scene_key(scene) == self._last_scene:
            return
        now = time.time()
        if now - self._last_scene_at < SCENE_EVERY_S:
            return
        self._last_scene_at = now  # a brain that is down is retried after the interval, not every frame
        if await self._post_seen({"type": "scene", "text": scene, "confidence": 1}):
            self._last_scene = scene_key(scene)
            self.scenes += 1
            logger.debug(f"scene: {scene}")

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
    # Each of these reads self._session once: after _stop() it is None and they do nothing (no assert, so a
    # call finishing during teardown never raises out of _analyze).

    async def _ask_model(self, jpg: bytes) -> tuple[list[dict], str]:
        session = self._session
        if session is None or self._stopped:
            raise RuntimeError("vision sampler stopped")
        body = {
            "model": self.cfg.model,
            "temperature": 0,
            "max_tokens": 260,
            "messages": [
                {"role": "system", "content": PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpg).decode()}},
                        {"type": "text", "text": "Scene and findings JSON."},
                    ],
                },
            ],
            **self.cfg.extra_body,
        }
        async with session.post(
            f"{self.cfg.base_url}/chat/completions",
            json=body,
            headers={"Authorization": f"Bearer {self.cfg.api_key}", "Accept": "application/json"},
            timeout=aiohttp.ClientTimeout(total=self.cfg.timeout_s),
        ) as r:
            if r.status == 429:
                try:
                    retry = float(r.headers.get("Retry-After", MODEL_BUSY_HOLD_S))
                except ValueError:
                    retry = MODEL_BUSY_HOLD_S
                raise ModelBusy(f"429 {(await r.text())[:160]}", min(max(retry, 1.0), MODEL_BUSY_MAX_HOLD_S))
            if r.status >= 300:
                raise RuntimeError(f"{r.status} {(await r.text())[:160]}")
            data = await r.json()
        content = data["choices"][0]["message"].get("content") or ""
        return parse_reply(content)

    async def _post_seen(self, seen: dict) -> bool:
        session = self._session
        if session is None or self._stopped:
            return False
        try:
            async with session.post(
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
        session = self._session
        if session is None or self._stopped:
            return
        try:
            async with session.post(
                f"{self.cfg.brain_url}/trace", json={"tool": tool, "summary": summary[:300]}, timeout=aiohttp.ClientTimeout(total=2)
            ) as r:
                if r.status >= 300:
                    logger.debug(f"brain answered {r.status} to /trace")
        except Exception as e:
            logger.debug(f"POST /trace failed ({e!r})")

    async def _say(self, text: str) -> None:
        """Speak through the brain, so the words go through its policy and the shared callout queue."""
        session = self._session
        if session is None or self._stopped:
            return
        try:
            async with session.post(
                f"{self.cfg.brain_url}/say", json={"text": text, "priority": 2, "kind": "vision"}, timeout=aiohttp.ClientTimeout(total=2)
            ) as r:
                if r.status >= 300:
                    logger.warning(f"brain answered {r.status} to /say")
        except Exception as e:
            logger.warning(f"POST /say failed ({e!r}); not spoken: {text!r}")
