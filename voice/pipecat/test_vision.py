"""Offline test of VisionSampler against a stub model and a stub brain on 127.0.0.1 (no NVIDIA key).

    .venv/bin/python test_vision.py

The stub model answers like the hosted Nemotron does (JSON, sometimes fenced or repeated); the stub brain
records what arrives at POST /seen and POST /say. Frames are synthetic InputImageRawFrames.
"""

import asyncio
import json
import sys
import tempfile
from pathlib import Path

from aiohttp import web
from loguru import logger

from pipecat.frames.frames import InputImageRawFrame, TranscriptionFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.workers.runner import WorkerRunner

import vision
from vision import VisionConfig, VisionSampler, parse_findings, to_seen

ID_CARD = {"type": "id_card", "name": "AVERY, JORDAN", "birth_date": "1968-03-14", "confidence": 0.99}
EPI = {"type": "medication", "drug": "epinephrine", "dose": "1 mg", "being_given": True, "confidence": 0.9}
EPI_LABEL_ONLY = {"type": "medication", "drug": "epinephrine", "dose": "1 mg", "being_given": False, "confidence": 0.9}
WEAK = {"type": "aed_pads", "confidence": 0.4}


class StubModel:
    def __init__(self):
        self.answers: list[str] = []
        self.calls = 0

    async def chat(self, request):
        self.calls += 1
        body = await request.json()
        assert body["messages"][1]["content"][0]["image_url"]["url"].startswith("data:image/jpeg;base64,")
        content = self.answers.pop(0) if self.answers else '{"findings": []}'
        if content == "FAIL":
            return web.json_response({"error": "boom"}, status=500)
        return web.json_response({"choices": [{"message": {"role": "assistant", "content": content}}]})


class StubBrain:
    def __init__(self):
        self.seen: list[dict] = []
        self.said: list[dict] = []

    async def post_seen(self, request):
        self.seen.append(await request.json())
        return web.json_response({"ok": True}, status=202)

    async def post_say(self, request):
        self.said.append(await request.json())
        return web.json_response({"ok": True}, status=202)


class Sink(FrameProcessor):
    """Records what passes the sampler: video must not, transcripts must."""

    def __init__(self):
        super().__init__()
        self.frames = []

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        self.frames.append(frame)
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

    assert to_seen(ID_CARD) == {"type": "id_card", "name": "AVERY, JORDAN", "birthDate": "1968-03-14", "confidence": 0.99}
    assert to_seen({**ID_CARD, "birth_date": "March 14 1968"}) is None, "non-ISO date is not acted on"
    assert to_seen(EPI) == {"type": "medication", "drug": "epinephrine", "dose": "1 mg", "confidence": 0.9}
    assert to_seen(EPI_LABEL_ONLY) is None, "a label in view is not a dose given (RB8)"
    assert to_seen({"type": "iv_io", "confidence": 0.8}) == {"type": "iv_io", "confidence": 0.8}
    assert to_seen({"type": "face", "confidence": 1}) is None
    print("pure functions OK")


async def run_pipeline():
    model, brain = StubModel(), StubBrain()
    app = web.Application()
    app.router.add_post("/v1/chat/completions", model.chat)
    app.router.add_post("/seen", brain.post_seen)
    app.router.add_post("/say", brain.post_say)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    base = f"http://127.0.0.1:{port}"

    evidence = Path(tempfile.mkdtemp()) / "evidence"
    cfg = VisionConfig(api_key="nvapi-test", model="stub", base_url=f"{base}/v1", brain_url=base, interval_s=0.05,
                       evidence_dir=evidence, extra_body={})
    sampler = VisionSampler(cfg)
    sink = Sink()
    pipeline = Pipeline([sampler, sink])
    worker = PipelineWorker(pipeline, idle_timeout_secs=None, enable_rtvi=False)
    started = asyncio.Event()

    @worker.event_handler("on_pipeline_started")
    async def _started(worker, frame):
        started.set()

    wr = WorkerRunner(handle_sigint=False)
    await wr.add_workers(worker)
    run = asyncio.create_task(wr.run())
    await asyncio.wait_for(started.wait(), 3)

    async def settle(n: float = 0.4):
        await asyncio.sleep(n)

    try:
        await checks(model, brain, sampler, sink, worker, evidence, settle)
    finally:
        await worker.cancel()
        await asyncio.wait_for(run, 5)
        await runner.cleanup()
        print(f"vision calls {sampler.calls}, findings {sampler.findings}")


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


if __name__ == "__main__":
    logger.remove()
    logger.add(sys.stderr, level="WARNING")
    test_pure_functions()
    asyncio.run(run_pipeline())
    print("test_vision OK")
