"""One voice session: WebRTC audio/video in → Nemotron ASR → Nemotron Omni (tools) → policy → Kokoro → WebRTC out."""
import asyncio
import time

from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import (
    Frame,
    InterimTranscriptionFrame,
    LLMContextFrame,
    LLMMessagesAppendFrame,
    TranscriptionFrame,
)
from pipecat.observers.user_bot_latency_observer import UserBotLatencyObserver
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.nvidia.stt import NvidiaSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai import tts as openai_tts
from pipecat.services.openai.tts import OpenAITTSService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

from . import clinical, config
from .policy import SpeechPolicy
from .state import StateWatcher
from .stdb import Stdb
from .tools import TOOLS, Grounding, VoiceTools
from .vision import VisionSampler

WF = "Voice"
SYSTEM = """You are Handoff, the voice assistant on a paramedic's harness. Synthetic-data prototype, not a medical device.
Speak in at most 15 words, plain speech, no lists or markdown. Use only facts from the state below and tool results;
never invent names, vitals, times, doses, allergies or findings, and never claim compression depth.
Advisory wording only ("Consider...", "Epi due"), never orders.
- Medic says a full name and birth date: call search_ehr.
- Allergy or dose question: call check_allergy or check_dose_range and say the result.
- Medic says a drug was given (e.g. "epi 1 milligram given"): call log_event (kind med_<generic>), then check_allergy
  and check_dose_range, then confirm in a few words.
- Medic says "look": call look and then reply SILENT.
- Lines starting with [monitor] are state changes, not the medic: speak only if the medic needs to hear it and the
  rules have not already said it, in 8 words or fewer.
- If there is nothing useful to say, reply exactly SILENT."""


class RivaSTT(NvidiaSTTService):
    """Riva's is_final results are final, so mark them finalized: the turn ends as soon as they arrive
    instead of waiting out Pipecat's STT timeout."""

    async def push_frame(self, frame: Frame, direction: FrameDirection = FrameDirection.DOWNSTREAM):
        if isinstance(frame, TranscriptionFrame):
            frame.finalized = True
        await super().push_frame(frame, direction)


class Transcripts(FrameProcessor):
    """Final transcript lines go to SpacetimeDB (W6 and the report read them) and to the grounding."""

    def __init__(self, stdb: Stdb, grounding: Grounding):
        super().__init__()
        self.stdb, self.grounding = stdb, grounding
        self.last_final_at = 0.0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InterimTranscriptionFrame):
            logger.debug(f"interim: {frame.text}")
        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            self.last_final_at = time.time()
            logger.info(f"heard: {frame.text}")
            self.grounding.add(frame.text)
            asyncio.create_task(self.stdb.call("add_transcript", frame.text.strip()))
        await self.push_frame(frame, direction)


class StateInjector(FrameProcessor):
    """Before every LLM run, refresh the system message with the compact state summary."""

    def __init__(self, state: StateWatcher):
        super().__init__()
        self.state = state

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, LLMContextFrame):
            msgs = frame.context.messages
            if msgs and msgs[0].get("role") == "system":
                msgs[0]["content"] = SYSTEM + "\n\nCurrent state: " + self.state.summary()
        await self.push_frame(frame, direction)


PROACTIVE_KINDS = ("vitals_alarm_spo2", "vitals_alarm_hr", "status_arrest", "status_rosc")


async def run_bot(conn: SmallWebRTCConnection, stdb: Stdb, state: StateWatcher, ehr: clinical.Ehr) -> None:
    grounding = Grounding(state)
    transport = SmallWebRTCTransport(
        webrtc_connection=conn,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True, video_in_enabled=True),
    )
    stt = RivaSTT(
        api_key=config.NVIDIA_API_KEY,
        model_function_map={"function_id": config.ASR_FUNCTION_ID, "model_name": ""},
    )
    # Riva endpointing: finalize after ~300 ms of silence instead of the server default (~800 ms).
    stt._stop_history, stt._stop_history_eou = config.ASR_STOP_HISTORY_MS, config.ASR_STOP_HISTORY_EOU_MS
    llm = OpenAILLMService(
        api_key=config.OMNI_API_KEY,
        base_url=config.OMNI_BASE_URL,
        settings=OpenAILLMService.Settings(
            model=config.OMNI_MODEL, temperature=0.2, max_completion_tokens=120,
            extra={"extra_body": {"chat_template_kwargs": {"enable_thinking": False}}},
        ),
    )
    openai_tts.VALID_VOICES.setdefault(config.KOKORO_VOICE, config.KOKORO_VOICE)  # Kokoro voice names
    tts = OpenAITTSService(api_key="none", base_url=config.KOKORO_BASE_URL, voice=config.KOKORO_VOICE, model="kokoro")

    policy = SpeechPolicy(stdb, grounding)
    vision_ref: dict = {}
    tools = VoiceTools(stdb, state, ehr, grounding, look=lambda: vision_ref["v"].look())
    vision = VisionSampler(stdb, state, tools, say=policy.say)
    vision_ref["v"] = vision
    tools.register(llm)

    context = LLMContext(messages=[{"role": "system", "content": SYSTEM}], tools=TOOLS)
    agg = LLMContextAggregatorPair(context, user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()))
    transcripts = Transcripts(stdb, grounding)

    pipeline = Pipeline([
        transport.input(), vision, stt, transcripts, agg.user(), StateInjector(state), llm, policy, tts,
        transport.output(), agg.assistant(),
    ])
    latency = UserBotLatencyObserver()

    @latency.event_handler("on_latency_measured")
    async def _on_latency(_obs, seconds: float, *args):
        logger.info(f"voice-to-voice {seconds * 1000:.0f} ms (user stopped → bot started)")
        await stdb.step(WF, "latency", f"medic stopped → Handoff speaking: {seconds * 1000:.0f} ms")

    task = PipelineTask(pipeline, params=PipelineParams(enable_metrics=True), observers=[latency])
    policy.queue = task.queue_frame

    pending: list[dict] = []
    handled_meds: set[int] = set()

    async def on_row(kind: str, row: dict) -> None:
        if kind == "callout" and row.get("spoken_at") is None:
            pending.append(row)
        if kind != "event":
            return
        ek = row["kind"]
        if ek.startswith("med_") and row["id"] not in handled_meds:
            handled_meds.add(row["id"])
            drug = ek[4:]
            allergy = clinical.check_allergy(drug, state.record)
            await stdb.step(WF, "check_allergy", f"{drug} → {allergy['text']}")
            if allergy["allergic"]:
                await stdb.call("add_callout", f"Caution: {drug} allergy on record.", 0)
            dose = clinical.parse_dose(row["label"])
            if dose:
                res = clinical.check_dose(drug, *dose)
                await stdb.step(WF, "check_dose_range", f"{row['label']} → {res['text']}")
                if res["in_range"] is False:
                    await stdb.call("add_callout", f"Check {drug} dose: {dose[0]:g} {dose[1]}.", 1)
        elif ek in PROACTIVE_KINDS:
            await stdb.step(WF, "trigger", f"{ek}: {row['label']} → asking Nemotron whether to speak")
            policy.proactive_next = True
            await task.queue_frame(LLMMessagesAppendFrame(
                messages=[{"role": "user", "content": f"[monitor] {row['label']}"}], run_llm=True))

    async def speak_callouts() -> None:
        while True:
            await asyncio.sleep(0.25)
            now_us = time.time() * 1e6
            pending[:] = [c for c in pending if now_us - c["created_at"] < 15e6]
            if not pending or not policy.can_callout():
                continue
            pending.sort(key=lambda c: (c["priority"], c["id"]))
            c = pending.pop(0)
            if await policy.say(c["text"], f"callout P{c['priority']}"):
                await stdb.call("callout_spoken", c["id"])

    unsubscribe = state.subscribe(on_row)
    speaker = asyncio.create_task(speak_callouts())

    @transport.event_handler("on_client_connected")
    async def _connected(_t, _c):
        await stdb.step(WF, "", "bodycam audio link up (Pipecat WebRTC)")

    @transport.event_handler("on_client_disconnected")
    async def _disconnected(_t, _c):
        await stdb.step(WF, "", f"bodycam audio link down; vision calls {vision.calls}")
        await task.cancel()

    try:
        await PipelineRunner(handle_sigint=False).run(task)
    finally:
        unsubscribe()
        speaker.cancel()
