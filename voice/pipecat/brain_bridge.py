"""BrainBridge: the Pipecat end of the brain's local API (voice/README.md, "Local API").

It sits between the STT/turn processors and TTS:

    ear    the medic's turn (its final transcripts) -> POST {brain}/transcript {"text": ..., "source": "pipecat"}
    mouth  WS {brain}/mouth   {"type":"speak","id","text","priority"} -> TTSSpeakFrame downstream
                              the bot finished that utterance          -> {"type":"spoken","id"}
           UserStarted/StoppedSpeakingFrame                            -> {"type":"user_speaking","active":bool}

`spoken` also goes back when an utterance did not play to the end, so the brain's one-at-a-time speaker never
stalls; an extra field says why: "interrupted": true (barge-in) or "error": "<why>" (no audio; the brain leaves
that row unspoken).

The ASR can split one sentence at a short pause ("epi ... one milligram"), so the final transcripts of one user
turn are joined and posted when the turn ends (or after MAX_TURN_HOLD_SECS, so noise that keeps the turn open
can't hold the words back).

The brain sends one speak at a time and waits for spoken. If another arrives anyway it is queued (lowest priority
number first, then oldest) and nothing starts while the medic is talking.

Event `on_mouth_lost(bridge, reason)`: the brain has been unreachable for `mouth_grace_secs`, or closed this mouth on
purpose (another mouth replaced it, or its TTS kept failing). The WebRTC session ends on it, so the phone's audio
link drops and the phone speaks callouts itself (spec §23 B11): a link that is up always has a working mouth.
"""

import asyncio
import json
from dataclasses import dataclass

import aiohttp
from loguru import logger

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    CancelFrame,
    EndFrame,
    ErrorFrame,
    Frame,
    InterimTranscriptionFrame,
    InterruptionFrame,
    StartFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

MAX_TURN_HOLD_SECS = 8.0
# The turn can end while the ASR is still finishing the last words (an interim is out, its final not yet in).
# Wait this long for that final so the tail of the sentence joins the turn instead of arriving as its own line.
LATE_FINAL_SECS = 1.2
LATE_FINAL_SETTLE_SECS = 0.05


@dataclass
class _Utterance:
    id: str
    text: str
    priority: int
    seq: int
    started: bool = False  # BotStartedSpeakingFrame seen for it


class BrainBridge(FrameProcessor):
    def __init__(
        self,
        brain_url: str = "http://127.0.0.1:8787",
        *,
        transcript_timeout: float = 2.0,
        start_timeout: float = 5.0,
        max_utterance_secs: float = 30.0,
        mouth_grace_secs: float = 1.5,
        **kwargs,
    ):
        """
        Args:
            brain_url: the brain's local API (BRAIN_URL).
            transcript_timeout: per POST /transcript; a slow or absent brain never blocks the pipeline.
            start_timeout: report the utterance as failed if no audio starts within this many seconds of the speak
                and TTS reported no error sooner.
            max_utterance_secs: report it anyway if the bot never stops speaking it.
            mouth_grace_secs: how long the brain may be unreachable (at start or after a drop) before
                on_mouth_lost fires.
        """
        super().__init__(**kwargs)
        self._transcript_url = f"{brain_url}/transcript"
        self._mouth_url = brain_url.replace("http://", "ws://", 1).replace("https://", "wss://", 1) + "/mouth"
        self._transcript_timeout = transcript_timeout
        self._start_timeout = start_timeout
        self._max_utterance_secs = max_utterance_secs
        self._mouth_grace_secs = mouth_grace_secs

        self._session: aiohttp.ClientSession | None = None
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._mouth_task: asyncio.Task | None = None
        self._lost_task: asyncio.Task | None = None  # set while an outage is being timed or was reported
        self._transcript_task: asyncio.Task | None = None
        self._transcripts: asyncio.Queue[str] = asyncio.Queue()
        self._turn_text: list[str] = []
        self._turn_hold: asyncio.Task | None = None
        self._interim_pending = False  # an interim arrived after the last final: words still being recognised
        self._late_final: asyncio.Task | None = None  # set while the ended turn waits for that final

        self._pending: list[_Utterance] = []
        self._current: _Utterance | None = None
        self._watchdog: asyncio.Task | None = None
        self._user_speaking = False
        self._seq = 0

        self._register_event_handler("on_mouth_lost")

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

        # Transcripts stop here: they go to the brain, and TTS must never read the medic's words back.
        if isinstance(frame, TranscriptionFrame):
            self._interim_pending = False
            text = frame.text.strip()
            if text:
                logger.info(f"heard: {text!r}")
                if self._user_speaking:
                    self._turn_text.append(text)
                    if self._turn_hold is None:
                        self._turn_hold = self.create_task(self._hold_turn(), name="turn_hold")
                elif self._late_final:
                    # A final for the turn that just ended: it belongs to that turn's line, sent together.
                    self._turn_text.append(text)
                else:
                    # Outside a turn (one the turn processor hasn't opened a turn for yet).
                    self._transcripts.put_nowait(text)
            return
        if isinstance(frame, InterimTranscriptionFrame):
            if frame.text.strip():
                self._interim_pending = True
            return

        # Everything else passes through first, so an interruption reaches TTS before anything new is queued.
        await self.push_frame(frame, direction)

        if isinstance(frame, UserStartedSpeakingFrame):
            self._user_speaking = True
            # Speaking again before the late final came: the same sentence continues; keep collecting.
            late, self._late_final = self._late_final, None
            if late:
                await self.cancel_task(late)
            await self._send({"type": "user_speaking", "active": True})
        elif isinstance(frame, UserStoppedSpeakingFrame):
            self._user_speaking = False
            if self._late_final is None:
                self._late_final = self.create_task(self._await_late_final(), name="late_final")
            await self._send({"type": "user_speaking", "active": False})
            await self._speak_next()
        elif isinstance(frame, InterruptionFrame):
            if self._current:
                await self._finish(interrupted=True)
        elif isinstance(frame, BotStartedSpeakingFrame):
            if self._current:
                self._current.started = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            # Only once it started: a late stop from an interrupted utterance must not end the next one.
            if self._current and self._current.started:
                await self._finish()
        elif isinstance(frame, ErrorFrame) and direction == FrameDirection.UPSTREAM:
            # Upstream errors reaching us come from TTS or the output (STT sits above us). If the utterance never
            # started playing, report now instead of waiting for the watchdog.
            if self._current and not self._current.started:
                await self._finish(error=f"tts: {frame.error}"[:120])

    # ---- hearing --------------------------------------------------------------------------------------------

    async def _flush_turn(self):
        hold, self._turn_hold = self._turn_hold, None
        late, self._late_final = self._late_final, None
        for task in (hold, late):
            if task and task is not asyncio.current_task():
                await self.cancel_task(task)
        if self._turn_text:
            self._transcripts.put_nowait(" ".join(self._turn_text))
            self._turn_text = []

    async def _await_late_final(self):
        # UserStoppedSpeakingFrame is a system frame and can overtake transcripts still queued behind it: give
        # those a moment to land before deciding whether the ASR is still on the last words.
        await asyncio.sleep(LATE_FINAL_SETTLE_SECS)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + LATE_FINAL_SECS
        while self._interim_pending and loop.time() < deadline:
            await asyncio.sleep(0.05)
        if self._interim_pending:
            logger.debug(f"no final within {LATE_FINAL_SECS} s of the turn ending; sending what was heard")
        self._interim_pending = False
        await self._flush_turn()

    async def _hold_turn(self):
        await asyncio.sleep(MAX_TURN_HOLD_SECS)
        if self._turn_text:
            logger.debug(f"turn still open after {MAX_TURN_HOLD_SECS} s; sending what was heard so far")
        await self._flush_turn()

    async def _transcript_loop(self):
        """POST transcripts one at a time, in order. Failures are logged and the line is dropped."""
        assert self._session
        timeout = aiohttp.ClientTimeout(total=self._transcript_timeout)
        while True:
            text = await self._transcripts.get()
            try:
                async with self._session.post(
                    self._transcript_url, json={"text": text, "source": "pipecat"}, timeout=timeout
                ) as resp:
                    if resp.status >= 300:
                        logger.warning(f"brain answered {resp.status} to /transcript; dropped {text!r}")
            except Exception as e:
                logger.warning(f"POST /transcript failed ({e!r}); dropped {text!r}")

    # ---- speaking -------------------------------------------------------------------------------------------

    async def _on_brain_message(self, raw: str):
        try:
            msg = json.loads(raw)
        except ValueError:
            logger.warning(f"brain sent non-JSON on /mouth: {raw[:80]!r}")
            return
        if msg.get("type") != "speak":
            logger.debug(f"ignoring brain message {msg.get('type')!r}")
            return

        utt_id = str(msg.get("id") or "")
        text = str(msg.get("text") or "").strip()
        if not utt_id or not text:
            logger.warning(f"speak without id or text: {msg}")
            return
        if (self._current and self._current.id == utt_id) or any(u.id == utt_id for u in self._pending):
            logger.debug(f"speak {utt_id} already queued")
            return

        self._seq += 1
        try:
            priority = int(msg.get("priority", 3))
        except (TypeError, ValueError):
            priority = 3
        self._pending.append(_Utterance(utt_id, text, priority, self._seq))
        await self._speak_next()

    async def _speak_next(self):
        """Start the next queued utterance, unless one is playing or the medic is talking."""
        if self._current or self._user_speaking or not self._pending:
            return
        utt = min(self._pending, key=lambda u: (u.priority, u.seq))
        self._pending.remove(utt)
        self._current = utt
        logger.info(f"speak [{utt.id}] P{utt.priority}: {utt.text!r}")
        self._watchdog = self.create_task(self._watch(utt), name="speak_watchdog")
        await self.push_frame(TTSSpeakFrame(utt.text, append_to_context=False))

    async def _watch(self, utt: _Utterance):
        await asyncio.sleep(self._start_timeout)
        if self._current is utt and not utt.started:
            logger.warning(f"no audio for [{utt.id}] after {self._start_timeout:g} s (TTS error?)")
            await self._finish(error="no audio")
            return
        await asyncio.sleep(self._max_utterance_secs)
        if self._current is utt:
            await self._finish(error="timeout")

    async def _finish(self, *, interrupted: bool = False, error: str | None = None):
        utt, self._current = self._current, None
        if utt is None:
            return
        watchdog, self._watchdog = self._watchdog, None
        if watchdog and watchdog is not asyncio.current_task():
            await self.cancel_task(watchdog)

        msg: dict = {"type": "spoken", "id": utt.id}
        if interrupted:
            msg["interrupted"] = True
            logger.info(f"interrupted [{utt.id}]")
        elif error:
            msg["error"] = error
            logger.warning(f"could not play [{utt.id}]: {error}")
        else:
            logger.debug(f"spoken [{utt.id}]")
        await self._send(msg)
        await self._speak_next()

    async def _drop_held_speech(self):
        """The mouth is gone: forget the queue and silence what is playing. The brain re-sends whatever it never
        got `spoken` for, so letting it finish would say it twice."""
        self._pending.clear()
        if self._current:
            self._current = None
            watchdog, self._watchdog = self._watchdog, None
            if watchdog:
                await self.cancel_task(watchdog)
            await self.push_frame(InterruptionFrame())

    # ---- connections to the brain ---------------------------------------------------------------------------

    async def _start(self):
        if self._session:
            return
        self._session = aiohttp.ClientSession()
        self._transcript_task = self.create_task(self._transcript_loop(), name="brain_transcripts")
        self._mouth_task = self.create_task(self._mouth_loop(), name="brain_mouth")

    async def _stop(self):
        tasks = (self._watchdog, self._turn_hold, self._lost_task, self._mouth_task, self._transcript_task)
        self._watchdog = self._turn_hold = self._lost_task = self._mouth_task = self._transcript_task = None
        for task in tasks:
            if task and not task.done():
                await self.cancel_task(task)
        if self._ws and not self._ws.closed:
            await self._ws.close()
        self._ws = None
        if self._session:
            await self._session.close()
            self._session = None

    async def _send(self, msg: dict):
        ws = self._ws
        if ws is None or ws.closed:
            return
        try:
            await ws.send_str(json.dumps(msg))
        except Exception as e:
            logger.warning(f"could not send {msg['type']} to the brain: {e!r}")

    def _time_outage(self):
        """Start timing an outage, once: on_mouth_lost fires if no connection is made within the grace period."""
        if self._lost_task is None:
            self._lost_task = self.create_task(self._report_lost_after_grace(), name="mouth_lost")

    async def _report_lost_after_grace(self):
        await asyncio.sleep(self._mouth_grace_secs)
        if self._ws is None:
            logger.warning(f"brain unreachable for {self._mouth_grace_secs:g} s")
            await self._call_event_handler("on_mouth_lost", "brain unreachable")

    async def _mouth_loop(self):
        """Keep a /mouth websocket open, reconnecting with backoff while the brain is down.

        A close the brain makes on purpose carries a reason (voice/src/speaker.ts: 1000 "replaced by a new mouth",
        1011 "tts failing"; any 4000-4999 code counts too). Then this mouth stays off until the next session:
        retrying would take the mouth back from the one that replaced it, or keep feeding a failing TTS.
        """
        assert self._session
        backoff, warned = 0.5, False
        self._time_outage()
        while True:
            close_code, reason = None, ""
            try:
                async with self._session.ws_connect(self._mouth_url, heartbeat=10) as ws:
                    self._ws = ws
                    if self._lost_task:
                        if not self._lost_task.done():
                            await self.cancel_task(self._lost_task)
                        self._lost_task = None
                    backoff, warned = 0.5, False
                    logger.info(f"connected to the brain at {self._mouth_url}")
                    if self._user_speaking:
                        await self._send({"type": "user_speaking", "active": True})
                    while True:
                        msg = await ws.receive()
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            await self._on_brain_message(msg.data)
                        elif msg.type == aiohttp.WSMsgType.CLOSE:
                            close_code, reason = msg.data, msg.extra or ""
                            break
                        elif msg.type in (aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            close_code = ws.close_code
                            break
                logger.warning(f"brain closed /mouth (code {close_code} {reason!r})")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                if not warned:
                    logger.warning(f"brain not reachable at {self._mouth_url} ({e!r}); retrying")
                    warned = True
            finally:
                self._ws = None
                await self._drop_held_speech()

            if reason or (close_code is not None and 4000 <= close_code <= 4999):
                logger.warning(f"the brain dropped this mouth ({reason or close_code}); not reconnecting this session")
                await self._call_event_handler("on_mouth_lost", reason or f"closed {close_code}")
                return
            self._time_outage()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 5.0)
