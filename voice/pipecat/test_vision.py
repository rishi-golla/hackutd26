"""Offline test of VisionSampler against a stub model, a stub brain and a stub Pi hub on 127.0.0.1 (no NVIDIA key).

    .venv/bin/python test_vision.py

The stub model answers like the hosted Nemotron does (JSON, sometimes fenced or repeated); the stub brain
records what arrives at POST /seen, /say and /trace; the stub hub answers GET /frame.jpg with 204 (nothing new).
Frames are synthetic InputImageRawFrames. The teardown tests also fail on Pipecat's "dangling tasks detected".
"""

import asyncio
import json
import sys
import tempfile
import time
from pathlib import Path

from aiohttp import web
from loguru import logger

from pipecat.frames.frames import CancelFrame, InputImageRawFrame, StartFrame, TranscriptionFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.workers.runner import WorkerRunner

import vision
from vision import VisionConfig, VisionSampler, parse_findings, parse_reply, to_seen

ID_CARD = {"type": "id_card", "name": "AVERY, JORDAN", "birth_date": "1968-03-14", "confidence": 0.99}
EPI = {"type": "medication", "drug": "epinephrine", "dose": "1 mg", "being_given": True, "confidence": 0.9}
EPI_LABEL_ONLY = {"type": "medication", "drug": "epinephrine", "dose": "1 mg", "being_given": False, "confidence": 0.9}
WEAK = {"type": "aed_pads", "confidence": 0.4}

DANGLING: list[str] = []  # Pipecat's "dangling tasks detected" warnings, collected by a loguru sink


class StubModel:
    def __init__(self):
        self.answers: list[str] = []
        self.calls = 0

    async def chat(self, request):
        self.calls += 1
        body = await request.json()
        assert body["messages"][1]["content"][0]["image_url"]["url"].startswith("data:image/jpeg;base64,")
        assert body["max_tokens"] == 260
        content = self.answers.pop(0) if self.answers else '{"findings": []}'
        if content == "FAIL":
            return web.json_response({"error": "boom"}, status=500)
        if content == "SLOW":
            await asyncio.sleep(10)  # the sampler gives up on it when the session ends
            content = '{"findings": []}'
        return web.json_response({"choices": [{"message": {"role": "assistant", "content": content}}]})


class StubBrain:
    def __init__(self):
        self.seen: list[dict] = []
        self.said: list[dict] = []
        self.traces: list[dict] = []

    async def post_seen(self, request):
        self.seen.append(await request.json())
        return web.json_response({"ok": True}, status=202)

    async def post_say(self, request):
        self.said.append(await request.json())
        return web.json_response({"ok": True}, status=202)

    async def post_trace(self, request):
        self.traces.append(await request.json())
        return web.json_response({"ok": True}, status=202)

    def scenes(self) -> list[dict]:
        return [s for s in self.seen if s.get("type") == "scene"]


class StubHub:
    def __init__(self):
        self.fetches = 0

    async def frame(self, request):
        self.fetches += 1
        return web.Response(status=204)


class Sink(FrameProcessor):
    """Records what passes the sampler: video must not, transcripts must."""

    def __init__(self):
        super().__init__()
        self.frames = []

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        self.frames.append(frame)
        await self.push_frame(frame, direction)


class SlowStart(FrameProcessor):
    """Holds the StartFrame like STT/TTS opening their gRPC streams: the sampler has started, the pipeline hasn't."""

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, StartFrame):
            await asyncio.sleep(2)
        await self.push_frame(frame, direction)


class EatsCancel(FrameProcessor):
    """An input transport whose teardown fails: the CancelFrame goes no further."""

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, CancelFrame):
            return
        await self.push_frame(frame, direction)


def frame(w: int = 64, h: int = 48) -> InputImageRawFrame:
    return InputImageRawFrame(image=bytes([200, 30, 30]) * (w * h), size=(w, h), format="RGB")


def test_pure_functions():
    assert parse_findings('{"findings": [%s]}' % json.dumps(ID_CARD)) == [ID_CARD]
    fenced = '```json\n{"findings": [%s]}\n```' % json.dumps(EPI)
    assert parse_findings(fenced) == [EPI]
    repeated = '{"findings": [%s]}\n```json\n{"findings": [%s]}\n```' % (json.dumps(ID_CARD), json.dumps(ID_CARD))
    assert parse_findings(repeated) == [ID_CARD], "the hosted Omni repeats its answer; only the first counts"
    assert parse_findings('Sure! Here it is: {"findings": []} Anything else?') == []
    try:
        parse_findings("no json here")
    except ValueError:
        pass
    else:
        raise AssertionError("prose without JSON must raise")

    # parse_reply: the findings and the scene sentence.
    scene = "Medic's gloved hands over the patient's chest, syringe in the right hand."
    assert parse_reply('{"scene": "%s", "findings": [%s]}' % (scene, json.dumps(EPI))) == ([EPI], scene)
    assert parse_reply('{"findings": [%s]}' % json.dumps(ID_CARD)) == ([ID_CARD], ""), "no scene → empty"
    assert parse_reply('```json\n{"scene": "%s", "findings": []}\n```' % scene) == ([], scene), "fenced"
    assert parse_reply('Here: {"scene": "%s", "findings": []} {"scene": "other", "findings": []} done' % scene) == ([], scene), \
        "prose around it and a repeated object: the first counts"
    assert parse_reply('{"scene": 42, "findings": []}') == ([], ""), "a non-string scene is dropped"
    assert parse_reply('{"scene": null, "findings": "none"}') == ([], ""), "a non-list findings is dropped"
    assert parse_reply('{"scene": "Two lines\\n of {text}", "findings": []}')[1] == "Two lines of text", "one line, no braces"
    long_scene = parse_reply(json.dumps({"scene": "word " * 80, "findings": []}))[1]
    assert 0 < len(long_scene) <= vision.SCENE_MAX_CHARS and "\n" not in long_scene, long_scene
    assert parse_reply('{"scene": "a } inside", "findings": [%s]}' % json.dumps(WEAK)) == ([WEAK], "a inside"), \
        "a brace inside the scene string does not break the parse"

    assert to_seen(ID_CARD) == {"type": "id_card", "name": "AVERY, JORDAN", "birthDate": "1968-03-14", "confidence": 0.99}
    assert to_seen({**ID_CARD, "birth_date": "March 14 1968"}) is None, "non-ISO date is not acted on"
    assert to_seen(EPI) == {"type": "medication", "drug": "epinephrine", "dose": "1 mg", "confidence": 0.9}
    assert to_seen(EPI_LABEL_ONLY) is None, "a label in view is not a dose given (RB8)"
    assert to_seen({"type": "iv_io", "confidence": 0.8}) == {"type": "iv_io", "confidence": 0.8}
    assert to_seen({"type": "face", "confidence": 1}) is None
    print("pure functions OK")


async def serve(model: StubModel, brain: StubBrain, hub: StubHub) -> tuple[str, web.AppRunner]:
    app = web.Application()
    app.router.add_post("/v1/chat/completions", model.chat)
    app.router.add_post("/seen", brain.post_seen)
    app.router.add_post("/say", brain.post_say)
    app.router.add_post("/trace", brain.post_trace)
    app.router.add_get("/frame.jpg", hub.frame)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    return f"http://127.0.0.1:{port}", runner


async def start(processors, **worker_kwargs) -> tuple[PipelineWorker, asyncio.Task, asyncio.Event]:
    worker = PipelineWorker(Pipeline(processors), idle_timeout_secs=None, enable_rtvi=False, **worker_kwargs)
    started = asyncio.Event()

    @worker.event_handler("on_pipeline_started")
    async def _started(worker, frame):
        started.set()

    wr = WorkerRunner(handle_sigint=False)
    await wr.add_workers(worker)
    return worker, asyncio.create_task(wr.run()), started


def assert_torn_down(sampler: VisionSampler, what: str):
    hub = sampler._hub_task
    assert hub is None or hub.done(), f"{what}: hub loop still running"
    assert not sampler._calls, f"{what}: vision calls still in flight: {sampler._calls}"
    assert sampler._session is None, f"{what}: HTTP session still open"
    assert sampler._stopped, f"{what}: sampler not stopped"
    assert not DANGLING, f"{what}: {DANGLING}"


async def run_pipeline():
    model, brain, hub = StubModel(), StubBrain(), StubHub()
    base, runner = await serve(model, brain, hub)

    evidence = Path(tempfile.mkdtemp()) / "evidence"
    cfg = VisionConfig(api_key="nvapi-test", model="stub", base_url=f"{base}/v1", brain_url=base, interval_s=0.05,
                       evidence_dir=evidence, extra_body={})
    sampler = VisionSampler(cfg)
    sink = Sink()
    worker, run, started = await start([sampler, sink])
    await asyncio.wait_for(started.wait(), 3)

    async def settle(n: float = 0.4):
        await asyncio.sleep(n)

    try:
        await checks(model, brain, sampler, sink, worker, evidence, settle)
    finally:
        await worker.cancel()
        await asyncio.wait_for(run, 5)
        await runner.cleanup()
        print(f"vision calls {sampler.calls}, findings {sampler.findings}, scenes {sampler.scenes}")
    assert hub.fetches == 0, "no HUB_URL, no hub fetches"
    assert_torn_down(sampler, "after cancel")


async def checks(model, brain, sampler, sink, worker, evidence, settle):
    # 1. A frame with an ID card: posted to /seen once, evidence saved, video not forwarded.
    model.answers = ['{"findings": [%s]}' % json.dumps(ID_CARD)]
    await worker.queue_frame(frame())
    await settle()
    assert brain.seen and brain.seen[-1]["type"] == "id_card" and brain.seen[-1]["name"] == "AVERY, JORDAN", brain.seen
    assert brain.seen[-1]["detail"].startswith("vision frame ") and list(evidence.glob("*-id_card.jpg")), "evidence frame kept"
    assert not any(isinstance(f, InputImageRawFrame) for f in sink.frames), "video frames stop at the sampler"
    assert not brain.said, "an unforced finding is not spoken by the sampler (the brain speaks the record)"
    print("1 id card → /seen OK")

    # 2. The same card again within the window: not reported twice. A new drug is.
    model.answers = ['{"findings": [%s, %s, %s]}' % (json.dumps(ID_CARD), json.dumps(EPI), json.dumps(WEAK))]
    await worker.queue_frame(frame())
    await settle()
    assert len(brain.seen) == 2 and brain.seen[-1] == {"type": "medication", "drug": "epinephrine", "dose": "1 mg",
                                                       "confidence": 0.9, "detail": brain.seen[-1]["detail"]}, brain.seen
    print("2 dedupe + confidence filter OK")

    # 3. Frames while a call is running are skipped, so vision never falls behind.
    calls_before = model.calls
    model.answers = ['{"findings": []}'] * 5
    for _ in range(5):
        await worker.queue_frame(frame())
    await settle()
    assert model.calls - calls_before <= 2, f"{model.calls - calls_before} calls for 5 frames in a burst"
    print("3 one call at a time OK")

    # 4. "Handoff, look": forces a frame, speaks the result through the brain, and passes the transcript on.
    model.answers = ['{"findings": [{"type": "aed_pads", "confidence": 0.95}]}']
    await worker.queue_frame(TranscriptionFrame(text="Handoff, look", user_id="", timestamp=""))
    await settle(0.1)  # input frames are system frames and overtake queued data frames; a real "look" is earlier anyway
    await worker.queue_frame(frame())
    await settle()
    assert any(isinstance(f, TranscriptionFrame) for f in sink.frames), "transcripts pass through"
    assert brain.seen[-1]["type"] == "aed_pads"
    assert brain.said and brain.said[-1]["text"] == "AED pads on.", brain.said
    print("4 look → spoken result OK")

    # 5. look with nothing in view, and a model failure on look.
    model.answers = ['{"findings": []}', "FAIL"]
    sampler.look()
    await worker.queue_frame(frame())
    await settle()
    assert brain.said[-1]["text"] == "Nothing I recognise.", brain.said
    sampler.look()
    await worker.queue_frame(frame())
    await settle()
    assert brain.said[-1]["text"] == "Camera check failed.", brain.said
    assert sampler.failures == 1
    print("5 look with nothing / failure OK")

    # 6. look at an ID card: /seen gets it (forced ignores the dedupe window) and the sampler stays quiet, since the
    # brain speaks the record summary.
    said_before = len(brain.said)
    model.answers = ['{"findings": [%s]}' % json.dumps(ID_CARD)]
    sampler.look()
    await worker.queue_frame(frame())
    await settle()
    assert brain.seen[-1]["type"] == "id_card" and len(brain.said) == said_before, (brain.seen[-1], brain.said)
    print("6 look at the card → brain speaks, sampler doesn't OK")

    # 7. The scene sentence: posted to /seen as type "scene" once; the same scene (case/spacing aside) is not posted
    # again; a changed one is, but not sooner than SCENE_EVERY_S after the last. Never traced, never spoken.
    vision.SCENE_EVERY_S = 1.0
    said_before, traces_before = len(brain.said), len(brain.traces)
    a, b, c = "Medic's gloved hands over the chest.", "Syringe in the medic's right hand.", "Bag-valve mask over the face."
    model.answers = ['```json\n{"scene": "%s", "findings": []}\n```' % a]
    await worker.queue_frame(frame())
    await settle()
    assert brain.scenes() == [{"type": "scene", "text": a, "confidence": 1}], brain.scenes()
    await settle(0.8)  # past the interval: only the dedupe holds the repeat back
    model.answers = ['{"scene": "  medic\'s GLOVED hands   over the chest. ", "findings": []}']
    await worker.queue_frame(frame())
    await settle()
    assert len(brain.scenes()) == 1, f"the same scene was posted again: {brain.scenes()}"
    model.answers = ['{"scene": "%s", "findings": []}' % b]
    await worker.queue_frame(frame())
    await settle()
    assert [s["text"] for s in brain.scenes()] == [a, b], brain.scenes()
    model.answers = ['{"scene": "%s", "findings": []}' % c]
    await worker.queue_frame(frame())
    await settle()
    assert len(brain.scenes()) == 2, f"a changed scene inside SCENE_EVERY_S was posted: {brain.scenes()}"
    await settle(0.8)
    model.answers = ['{"scene": "%s", "findings": []}' % c]
    await worker.queue_frame(frame())
    await settle()
    assert [s["text"] for s in brain.scenes()] == [a, b, c], brain.scenes()
    assert len(brain.said) == said_before, "a scene is never spoken"
    assert not any(t in json.dumps(brain.traces[traces_before:]) for t in ("gloved", "Syringe", "Bag-valve")), brain.traces
    vision.SCENE_EVERY_S = 5.0
    print("7 scene → /seen once, repeat suppressed, change after the interval posted OK")


async def run_hub_and_teardown():
    """8. The hub fallback runs only without WebRTC video, and a cancelled session leaves nothing running.
    9. cleanup() twice is harmless, and nothing starts after it."""
    model, brain, hub = StubModel(), StubBrain(), StubHub()
    base, runner = await serve(model, brain, hub)
    cfg = VisionConfig(api_key="nvapi-test", model="stub", base_url=f"{base}/v1", brain_url=base, interval_s=0.05,
                       evidence_dir=Path(tempfile.mkdtemp()), hub_url=base, extra_body={})
    sampler = VisionSampler(cfg)
    worker, run, started = await start([sampler, Sink()])
    await asyncio.wait_for(started.wait(), 3)
    hub_task = call = None
    try:
        # No video yet: the hub is polled.
        await asyncio.sleep(0.6)
        assert hub.fetches > 0, "no WebRTC video: the hub fallback should poll /frame.jpg"

        # WebRTC video arriving: the hub is left alone.
        await worker.queue_frame(frame())
        await asyncio.sleep(0.3)
        hub.fetches = 0
        for _ in range(6):
            await worker.queue_frame(frame())
            await asyncio.sleep(0.2)
        assert hub.fetches == 0, f"{hub.fetches} hub fetches while WebRTC video was arriving"

        # Video stops for more than HUB_FALLBACK_AFTER_S: the hub is polled again.
        await asyncio.sleep(vision.HUB_FALLBACK_AFTER_S + 0.5)
        assert hub.fetches > 0, "the hub fallback did not resume after the video stopped"
        print("8a hub fallback only without WebRTC video OK")

        # A call in flight when the session ends.
        model.answers = ["SLOW"]
        await worker.queue_frame(frame())
        await asyncio.sleep(0.3)
        assert len(sampler._calls) == 1, f"one vision call in flight, got {sampler._calls}"
        call = next(iter(sampler._calls))
        hub_task = sampler._hub_task
        assert hub_task and not hub_task.done()
    finally:
        t0 = time.monotonic()
        await worker.cancel()
        await asyncio.wait_for(run, 5)
    took = time.monotonic() - t0
    assert took < 1.0, f"teardown took {took:.2f} s"
    assert hub_task is not None and hub_task.done(), "hub loop still running after cancel"
    assert_torn_down(sampler, "cancelled session")
    assert call is not None and call.cancelled(), "the in-flight model call was not cancelled"
    assert sampler.failures == 0, "a call cut off by the teardown is not a model failure"
    print(f"8b cancel → hub loop, in-flight call and session released in {took * 1000:.0f} ms OK")

    # 9. cleanup() again (the worker already ran it) and once more: harmless. Nothing starts after it.
    await sampler.cleanup()
    await sampler.cleanup()
    sampler._begin(b"\xff\xd8 not really a jpeg")
    sampler.look()
    assert not sampler._due() and not sampler._calls, "a stopped sampler started a model call"
    await sampler._start()
    assert sampler._session is None and sampler._hub_task is None, "a stopped sampler restarted"
    assert await sampler._post_seen({"type": "scene", "text": "x", "confidence": 1}) is False
    await sampler._trace("vision", "after stop")
    await sampler._say("after stop")
    fetches = hub.fetches
    await asyncio.sleep(0.5)
    assert hub.fetches == fetches, "the hub was polled after the session ended"
    assert_torn_down(sampler, "after cleanup twice")
    print("9 cleanup twice harmless; nothing runs after stop OK")
    await runner.cleanup()


async def run_cancel_without_cancel_frame():
    """10, 11. The two Pipecat paths where no CancelFrame reaches the sampler, only cleanup(): the session cancelled
    while its StartFrame is still on the way down (the leak seen live after phone reconnects), and a CancelFrame
    stopped upstream (a transport whose teardown failed)."""
    model, brain, hub = StubModel(), StubBrain(), StubHub()
    base, runner = await serve(model, brain, hub)

    def make():
        return VisionSampler(VisionConfig(api_key="nvapi-test", model="stub", base_url=f"{base}/v1", brain_url=base,
                                          interval_s=0.05, evidence_dir=Path(tempfile.mkdtemp()), hub_url=base, extra_body={}))

    sampler = make()
    worker, run, started = await start([sampler, SlowStart()])
    await asyncio.sleep(0.5)
    assert not started.is_set() and sampler._hub_task and not sampler._hub_task.done(), "sampler started, pipeline not yet"
    await worker.cancel()
    await asyncio.wait_for(run, 5)
    assert_torn_down(sampler, "cancelled while starting")
    print("10 cancel before the pipeline finished starting → released by cleanup() OK")

    sampler = make()
    worker, run, started = await start([EatsCancel(), sampler], cancel_timeout_secs=0.5)
    await asyncio.wait_for(started.wait(), 3)
    await asyncio.sleep(0.3)
    await worker.cancel()
    await asyncio.wait_for(run, 5)
    assert_torn_down(sampler, "CancelFrame stopped upstream")
    print("11 CancelFrame lost upstream → released by cleanup() OK")
    await runner.cleanup()


if __name__ == "__main__":
    logger.remove()
    logger.add(sys.stderr, level="WARNING")
    logger.add(lambda m: DANGLING.append(m.record["message"]), level="WARNING", filter=lambda r: "dangling" in r["message"])
    test_pure_functions()
    asyncio.run(run_pipeline())
    asyncio.run(run_hub_and_teardown())
    asyncio.run(run_cancel_without_cancel_frame())
    print("test_vision OK")
