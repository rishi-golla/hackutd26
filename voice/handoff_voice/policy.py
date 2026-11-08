"""Speech policy between Nemotron and TTS (spec §15, §19 agent rules).

Buffers each reply, then speaks it only if it is short, adds no number that isn't in the state or a tool result,
isn't a repeat, and (for unprompted speech) respects the 20 s / 8-word limits. Rule and workflow callouts from
SpacetimeDB are spoken through the same gate, at most one per 4 s, never while the medic is talking.
"""
import asyncio
import re
import time

from loguru import logger
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    TTSSpeakFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from . import config
from .stdb import Stdb
from .tools import Grounding

WF = "Voice"
NUM = re.compile(r"\d+(?:\.\d+)?")


def _norm(t: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", t.lower()).strip()


class SpeechPolicy(FrameProcessor):
    def __init__(self, stdb: Stdb, grounding: Grounding):
        super().__init__()
        self.stdb, self.grounding = stdb, grounding
        self._buf: list[str] = []
        self._in_reply = False
        self.user_speaking = False
        self.bot_speaking = False
        self.proactive_next = False
        self._last_spoken = 0.0
        self._last_proactive = 0.0
        self._recent: list[tuple[float, str]] = []
        self.queue = None  # set to task.queue_frame by the bot

    # -- checks ---------------------------------------------------------------------------------------------
    def _repeat(self, text: str) -> bool:
        now = time.time()
        self._recent = [(t, s) for t, s in self._recent if now - t < config.REPEAT_WINDOW_S]
        return any(s == _norm(text) for _, s in self._recent)

    def vet(self, text: str, proactive: bool) -> tuple[str | None, str]:
        text = re.sub(r"[*#_`>\[\]]", "", text).strip()
        if not text or text.upper().startswith("SILENT"):
            return None, "silent"
        limit = config.PROACTIVE_MAX_WORDS if proactive else config.REPLY_MAX_WORDS
        if len(text.split()) > limit:
            kept = ""
            for s in re.split(r"(?<=[.!?])\s+", text):
                if len((kept + " " + s).split()) > limit:
                    break
                kept = (kept + " " + s).strip()
            if not kept:
                return None, f"too long ({len(text.split())} words)"
            text = kept
        ground = self.grounding.text()
        for n in NUM.findall(text):
            if not re.search(rf"(?<![\d.]){re.escape(n)}(?![\d])", ground):
                return None, f"unsupported number {n}"
        if re.search(r"\bdepth\b", text, re.I):
            return None, "claims compression depth"
        if self._repeat(text):
            return None, "repeat"
        if proactive and (self.user_speaking or time.time() - self._last_proactive < config.PROACTIVE_GAP_S):
            return None, "proactive limit"
        return text, ""

    def _spoke(self, text: str, proactive: bool) -> None:
        now = time.time()
        self._last_spoken = now
        if proactive:
            self._last_proactive = now
        self._recent.append((now, _norm(text)))

    def can_callout(self) -> bool:
        return not self.user_speaking and not self.bot_speaking and time.time() - self._last_spoken >= config.CALLOUT_GAP_S

    async def say(self, text: str, source: str) -> bool:
        """Speak a deterministic line (callout, vision result). Still no repeats."""
        if self._repeat(text) or not self.queue:
            return False
        self._spoke(text, False)
        await self.queue(TTSSpeakFrame(text))
        await self.stdb.step(WF, "say", f'"{text}" ({source})')
        return True

    # -- frames ---------------------------------------------------------------------------------------------
    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, UserStartedSpeakingFrame):
            self.user_speaking = True
        elif isinstance(frame, UserStoppedSpeakingFrame):
            self.user_speaking = False
        elif isinstance(frame, BotStartedSpeakingFrame):
            self.bot_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self.bot_speaking = False
        elif isinstance(frame, InterruptionFrame):
            self._buf, self._in_reply = [], False

        if isinstance(frame, LLMFullResponseStartFrame):
            self._buf, self._in_reply = [], True
        elif isinstance(frame, LLMTextFrame) and self._in_reply:
            self._buf.append(frame.text)
            return
        elif isinstance(frame, LLMFullResponseEndFrame):
            self._in_reply = False
            proactive, self.proactive_next = self.proactive_next, False
            raw = "".join(self._buf).strip()
            logger.info(f"reply: {raw!r}")
            if raw:
                text, why = self.vet(raw, proactive)
                if text:
                    self._spoke(text, proactive)
                    await self.push_frame(TTSSpeakFrame(text))
                    asyncio.create_task(self.stdb.step(WF, "say", f'"{text}"' + (" (unprompted)" if proactive else "")))
                elif why != "silent":
                    asyncio.create_task(self.stdb.step(WF, "policy", f'held back "{raw[:120]}": {why}'))
        await self.push_frame(frame, direction)
