"""Offline test of BrainBridge against a stub brain on 127.0.0.1 (no NVIDIA key, no audio).

    .venv/bin/python test_bridge.py

The stub speaks the voice/README.md "Local API" contract; a recorder stands in for TTS and the output
transport, and the bot's speaking frames are injected upstream the way the output transport sends them.
"""

import asyncio
import json
import sys

from aiohttp import web
from loguru import logger

import brain_bridge
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    EndFrame,
    ErrorFrame,
    InterimTranscriptionFrame,
    InterruptionFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.workers.runner import WorkerRunner

from brain_bridge import BrainBridge

UP = FrameDirection.UPSTREAM


class StubBrain:
    def __init__(self):
        self.transcripts: list[dict] = []
        self.inbox: asyncio.Queue[dict] = asyncio.Queue()
        self.ws: web.WebSocketResponse | None = None
        self.connects = 0
        self.connected = asyncio.Event()

    async def post_transcript(self, request):
        self.transcripts.append(await request.json())
        return web.json_response({"id": f"t{len(self.transcripts)}"}, status=202)

    async def mouth(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.ws, self.connects = ws, self.connects + 1
        self.connected.set()
        async for msg in ws:
            await self.inbox.put(json.loads(msg.data))
        return ws

    async def speak(self, utt_id: str, text: str, priority: int = 2):
        await self.ws.send_json({"type": "speak", "id": utt_id, "text": text, "priority": priority})

    async def expect(self, want: dict, timeout: float = 2.0):
        msg = await asyncio.wait_for(self.inbox.get(), timeout)
        assert msg == want, f"brain got {msg}, expected {want}"


class Recorder(FrameProcessor):
    """Stands in for TTS + output: records what the bridge sends downstream."""

    def __init__(self):
        super().__init__()
        self.spoken: asyncio.Queue[str] = asyncio.Queue()
        self.leaked: list = []
        self.interruptions = 0

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, TTSSpeakFrame):
                await self.spoken.put(frame.text)
            elif isinstance(frame, (TranscriptionFrame, InterimTranscriptionFrame)):
                self.leaked.append(frame)
            elif isinstance(frame, InterruptionFrame):
                self.interruptions += 1
        await self.push_frame(frame, direction)

    async def expect(self, text: str, timeout: float = 2.0):
        got = await asyncio.wait_for(self.spoken.get(), timeout)
        assert got == text, f"TTS got {got!r}, expected {text!r}"

    async def expect_nothing(self, wait: float = 0.3):
        await asyncio.sleep(wait)
        assert self.spoken.empty(), f"TTS got {self.spoken.get_nowait()!r} too early"


async def main():
    brain = StubBrain()
    app = web.Application()
    app.router.add_post("/transcript", brain.post_transcript)
    app.router.add_get("/mouth", brain.mouth)
    server = web.AppRunner(app)
    await server.setup()
    site = web.TCPSite(server, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]

    brain_bridge.MAX_TURN_HOLD_SECS = 0.5
    brain_bridge.LATE_FINAL_SECS = 0.4
    bridge = BrainBridge(f"http://127.0.0.1:{port}", start_timeout=0.5)
    lost: list[str] = []

    @bridge.event_handler("on_mouth_lost")
    async def _lost(bridge, reason):
        lost.append(reason)

    tts = Recorder()
    worker = PipelineWorker(Pipeline([bridge, tts]), idle_timeout_secs=None, enable_rtvi=False)
    started = asyncio.Event()

    @worker.event_handler("on_pipeline_started")
    async def _started(worker, frame):
        started.set()

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    run = asyncio.create_task(runner.run())
    await asyncio.wait_for(started.wait(), 3)
    await asyncio.wait_for(brain.connected.wait(), 3)
    print("ok  bridge connects to /mouth on start")

    # Ear: finals are POSTed in order, interims dropped, neither reaches TTS.
    await worker.queue_frame(InterimTranscriptionFrame("epi one", "medic", "t"))
    await worker.queue_frame(TranscriptionFrame("Epi one milligram IO.", "medic", "t"))
    await worker.queue_frame(TranscriptionFrame("Giving the i-gel now.", "medic", "t"))
    await asyncio.sleep(0.3)
    assert brain.transcripts == [
        {"text": "Epi one milligram IO.", "source": "pipecat"},
        {"text": "Giving the i-gel now.", "source": "pipecat"},
    ], brain.transcripts
    assert not tts.leaked, "a transcript reached TTS"
    print("ok  final transcripts POSTed in order; interims and transcripts kept from TTS")

    # Never talk over the medic: a speak during their turn waits for the turn to end.
    await worker.queue_frame(UserStartedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": True})
    await brain.speak("c1", "Copy. Epinephrine one milligram.", priority=0)
    await tts.expect_nothing()
    await worker.queue_frame(UserStoppedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": False})
    await tts.expect("Copy. Epinephrine one milligram.")
    await worker.queue_frame(BotStartedSpeakingFrame(), UP)
    await worker.queue_frame(BotStoppedSpeakingFrame(), UP)
    await brain.expect({"type": "spoken", "id": "c1"})
    print("ok  speak held while the medic talks, spoken after the bot stops")

    # A second speak while one plays is queued; lower priority number goes first; barge-in reports interrupted.
    await brain.speak("c2", "Record found.", priority=2)
    await tts.expect("Record found.")
    await brain.speak("c3", "Consider rhythm check.", priority=3)
    await brain.speak("c4", "Warning. Allergy.", priority=0)
    await tts.expect_nothing()
    await worker.queue_frame(BotStartedSpeakingFrame(), UP)
    await worker.queue_frame(InterruptionFrame())
    await brain.expect({"type": "spoken", "id": "c2", "interrupted": True})
    await tts.expect("Warning. Allergy.")
    await worker.queue_frame(BotStoppedSpeakingFrame(), UP)  # the interrupted c2's late stop must not end c4
    await tts.expect_nothing()
    await worker.queue_frame(BotStartedSpeakingFrame(), UP)
    await worker.queue_frame(BotStoppedSpeakingFrame(), UP)
    await brain.expect({"type": "spoken", "id": "c4"})
    await tts.expect("Consider rhythm check.")
    print("ok  queue by priority; barge-in -> spoken+interrupted; stale stop ignored")

    # No audio ever starts (TTS failure): the watchdog reports so the brain's speaker does not stall.
    await brain.expect({"type": "spoken", "id": "c3", "error": "no audio"}, timeout=2)
    print("ok  watchdog reports spoken+error when TTS never plays")

    # A TTS error before any audio is reported at once, not after the watchdog.
    await brain.speak("c5", "Push faster.", priority=1)
    await tts.expect("Push faster.")
    await worker.queue_frame(ErrorFrame("synthesis failed: RESOURCE_EXHAUSTED"), UP)
    msg = await asyncio.wait_for(brain.inbox.get(), 1)
    assert msg["id"] == "c5" and msg["error"].startswith("tts: "), msg
    print("ok  TTS ErrorFrame -> spoken+error right away")

    # One turn, several ASR finals: joined into one line when the turn ends.
    await worker.queue_frame(UserStartedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": True})
    await worker.queue_frame(TranscriptionFrame("Epi.", "medic", "t"))
    await worker.queue_frame(TranscriptionFrame("One milligram IO.", "medic", "t"))
    await asyncio.sleep(0.3)
    assert len(brain.transcripts) == 2, "posted before the turn ended"
    await worker.queue_frame(UserStoppedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": False})
    await asyncio.sleep(0.2)
    assert brain.transcripts[2:] == [{"text": "Epi. One milligram IO.", "source": "pipecat"}], brain.transcripts
    print("ok  finals of one turn posted as one line at turn end")

    # A turn held open by noise does not hold the words back past MAX_TURN_HOLD_SECS.
    await worker.queue_frame(UserStartedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": True})
    await worker.queue_frame(TranscriptionFrame("Starting compressions.", "medic", "t"))
    await asyncio.sleep(brain_bridge.MAX_TURN_HOLD_SECS + 0.3)
    assert brain.transcripts[3:] == [{"text": "Starting compressions.", "source": "pipecat"}], brain.transcripts
    await worker.queue_frame(UserStoppedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": False})
    print("ok  an open turn flushes after the hold cap")

    # The turn ends while the ASR is still on the last word: its late final joins the turn's line.
    await worker.queue_frame(UserStartedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": True})
    await worker.queue_frame(TranscriptionFrame("Patient is in cardiac", "medic", "t"))
    await worker.queue_frame(InterimTranscriptionFrame("arr", "medic", "t"))
    await worker.queue_frame(UserStoppedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": False})
    await asyncio.sleep(0.1)
    assert len(brain.transcripts) == 4, "posted before the late final arrived"
    await worker.queue_frame(TranscriptionFrame("arrest.", "medic", "t"))
    await asyncio.sleep(0.2)
    assert brain.transcripts[4:] == [{"text": "Patient is in cardiac arrest.", "source": "pipecat"}], brain.transcripts
    print("ok  a final arriving after the turn ended completes that turn's line")

    # No final ever comes: what was heard is still sent, after LATE_FINAL_SECS.
    await worker.queue_frame(UserStartedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": True})
    await worker.queue_frame(TranscriptionFrame("Pupils are equal", "medic", "t"))
    await worker.queue_frame(InterimTranscriptionFrame("and", "medic", "t"))
    await worker.queue_frame(UserStoppedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": False})
    await asyncio.sleep(brain_bridge.LATE_FINAL_SECS + 0.3)
    assert brain.transcripts[5:] == [{"text": "Pupils are equal", "source": "pipecat"}], brain.transcripts
    print("ok  the late-final wait is capped")

    # Speaking again during the wait: one sentence with a pause stays one line.
    await worker.queue_frame(UserStartedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": True})
    await worker.queue_frame(TranscriptionFrame("Giving three hundred milligrams of", "medic", "t"))
    await worker.queue_frame(InterimTranscriptionFrame("amio", "medic", "t"))
    await worker.queue_frame(UserStoppedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": False})
    await worker.queue_frame(UserStartedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": True})
    await worker.queue_frame(TranscriptionFrame("amiodarone.", "medic", "t"))
    await worker.queue_frame(UserStoppedSpeakingFrame())
    await brain.expect({"type": "user_speaking", "active": False})
    await asyncio.sleep(0.2)
    assert brain.transcripts[6:] == [{"text": "Giving three hundred milligrams of amiodarone.", "source": "pipecat"}], brain.transcripts
    print("ok  speech resuming during the wait continues the same line")

    # The brain dropping the socket with no reason: reconnect within the grace period, no mouth_lost.
    for code in (1011, 1005):
        brain.connected.clear()
        await brain.ws.close(code=code)
        await asyncio.wait_for(brain.connected.wait(), 3)
    assert brain.connects == 3 and not lost, (brain.connects, lost)
    print("ok  reconnects after an unexplained drop, no mouth_lost")

    # The mouth dropping mid-utterance silences it (the brain re-sends it to the next mouth).
    await brain.speak("c6", "Epi due.", priority=1)
    await tts.expect("Epi due.")
    await worker.queue_frame(BotStartedSpeakingFrame(), UP)
    before = tts.interruptions
    brain.connected.clear()
    await brain.ws.close(code=1011, message=b"tts failing")  # speaker.ts after repeated playback errors
    await asyncio.sleep(0.3)
    assert tts.interruptions == before + 1, "playing audio not interrupted when the mouth dropped"
    print("ok  audio interrupted when the mouth drops mid-utterance")
    await asyncio.sleep(0.2)
    assert lost == ["tts failing"], lost
    await asyncio.sleep(1.0)
    assert brain.connects == 3, "reconnected after the brain dropped this mouth on purpose"
    print("ok  brain close with a reason ('tts failing') -> mouth_lost, no reconnect")

    # Brain down from the start: mouth_lost after the grace period.
    lonely = BrainBridge("http://127.0.0.1:9", mouth_grace_secs=0.5)
    lonely_lost: list[str] = []

    @lonely.event_handler("on_mouth_lost")
    async def _lonely_lost(bridge, reason):
        lonely_lost.append(reason)

    w2 = PipelineWorker(Pipeline([lonely, Recorder()]), idle_timeout_secs=None, enable_rtvi=False)
    r2 = WorkerRunner(handle_sigint=False)
    await r2.add_workers(w2)
    run2 = asyncio.create_task(r2.run())
    await asyncio.sleep(1.2)
    assert lonely_lost == ["brain unreachable"], lonely_lost
    await w2.queue_frame(EndFrame())
    await asyncio.wait_for(run2, 5)
    print("ok  brain unreachable at start -> mouth_lost once after the grace period")

    await worker.queue_frame(EndFrame())
    await asyncio.wait_for(run, 5)
    await server.cleanup()
    print("all bridge tests passed")


if __name__ == "__main__":
    logger.remove()
    logger.add(sys.stderr, level="WARNING")
    asyncio.run(main())
