"""Handoff voice worker: the ears and mouth of the brain in voice/src (spec §19, §22.6).

    python run.py                          WebRTC on http://0.0.0.0:7860, test page at /client
    python run.py --ssl                    the same on https (a phone needs https for the microphone)
    python run.py --transport local        laptop mic and speakers (needs PortAudio + PyAudio)
    python run.py --check                  build every pipeline with a dummy key; no audio, no network
    python run.py --list-voices            ask the hosted TTS which voices it has (needs the key)

Pipeline:

    transport.input() → Silero VAD → NVIDIA streaming ASR → user turns → BrainBridge → NVIDIA Magpie TTS → transport.output()

There is no LLM here. The brain (Nemotron, tools, policy) gets each final transcript over POST /transcript and
says things through WS /mouth; BrainBridge (brain_bridge.py) is the glue.
"""

import argparse
import asyncio
import sys
import uuid
from contextlib import asynccontextmanager
from dataclasses import replace
from importlib.metadata import version

from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.services.nvidia.stt import NvidiaSTTService
from pipecat.services.nvidia.tts import NvidiaTTSService
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.turns.user_start import TranscriptionUserTurnStartStrategy, VADUserTurnStartStrategy
from pipecat.turns.user_stop import SpeechTimeoutUserTurnStopStrategy
from pipecat.turns.user_turn_processor import UserTurnProcessor
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.workers.runner import WorkerRunner

from brain_bridge import BrainBridge
from config import ASR_MODEL, NVIDIA_SPEECH_SERVER, TTS_MODEL, Config, load_config

# How long the medic may pause before the turn ends and the brain may speak again (after VAD's own 0.2 s). Short,
# because a read-back waits for it. BrainBridge joins the ASR finals of one turn, so "epi ... one milligram"
# with a pause shorter than this reaches the brain as one line.
USER_SPEECH_TIMEOUT = 0.5


def build_pipeline(transport: BaseTransport, cfg: Config, *, barge_in: bool = True) -> tuple[Pipeline, BrainBridge]:
    stt = NvidiaSTTService(
        api_key=cfg.api_key,
        server=NVIDIA_SPEECH_SERVER,
        model_function_map={"function_id": cfg.asr_function_id, "model_name": cfg.asr_model},
        # 20 instead of Riva's mild default 4: at the default, "epi" still came back as FEIO/EBI (Sat 22:05).
        settings=NvidiaSTTService.Settings(boosted_lm_words=cfg.boost_words, boosted_lm_score=20.0) if cfg.boost_words else None,
    )
    tts = NvidiaTTSService(
        api_key=cfg.api_key,
        server=NVIDIA_SPEECH_SERVER,
        model_function_map={"function_id": cfg.tts_function_id, "model_name": TTS_MODEL},
        settings=NvidiaTTSService.Settings(voice=cfg.voice, language=Language.EN_US),
    )

    # VAD (Silero, local ONNX) feeds the turn processor, which emits UserStarted/StoppedSpeakingFrame and, with
    # barge-in on, interrupts the bot as soon as the medic starts talking (Pipecat's own interruption handling).
    # Stricter than Pipecat's defaults (0.7 / 0.2 s / 0.6): the chest mic also hears the room, and a passing
    # sentence from a teammate was interrupting the agent (seen live, Sat 21:57). Louder and longer speech only.
    vad = VADProcessor(vad_analyzer=SileroVADAnalyzer(params=VADParams(confidence=0.85, start_secs=0.4, stop_secs=0.5, min_volume=0.75)))
    turns = UserTurnProcessor(
        user_turn_strategies=UserTurnStrategies(
            start=[
                VADUserTurnStartStrategy(enable_interruptions=barge_in),
                # Transcripts start a turn but never interrupt: only sustained speech on the VAD does.
                TranscriptionUserTurnStartStrategy(enable_interruptions=False),
            ],
            # A plain silence timeout rather than Pipecat's default smart-turn model: predictable, and a clipped
            # "epi in" never waits on a classifier deciding whether the medic sounded finished.
            stop=[SpeechTimeoutUserTurnStopStrategy(user_speech_timeout=USER_SPEECH_TIMEOUT)],
        )
    )
    # 6 s grace: a brain restart (about 1 s) must not end the phone's session.
    bridge = BrainBridge(cfg.brain_url, mouth_grace_secs=6.0)

    return Pipeline([transport.input(), vad, stt, turns, bridge, tts, transport.output()]), bridge


def make_worker(pipeline: Pipeline) -> PipelineWorker:
    return PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True),  # logs STT/TTS time-to-first-byte
        # A bodycam can sit quiet for minutes; never end the session for being idle.
        idle_timeout_secs=None,
        # If STT or TTS fails for good (bad key: auth and invalid-request errors), end the session: the phone sees
        # the link drop and goes to on-device mode (spec §23 B11). Transient TTS errors (rate limit, network) are
        # reported to the brain as failed playback; it drops the mouth after repeated failures, which ends the
        # session through on_mouth_lost.
        processor_unusable_policy=ProcessorUnusablePolicy.END,
    )


# ---- local: laptop mic and speakers -------------------------------------------------------------------------


def local_transport():
    try:
        from pipecat.transports.local.audio import LocalAudioTransport, LocalAudioTransportParams
    except ImportError:
        sys.exit(
            "--transport local needs PyAudio, which needs PortAudio:\n"
            "  brew install portaudio && uv pip install -p .venv 'pipecat-ai[local]==1.15.0'\n"
            "or test in the laptop browser instead: python run.py, then open http://localhost:7860/client"
        )
    return LocalAudioTransport(LocalAudioTransportParams(audio_in_enabled=True, audio_out_enabled=True))


async def run_local(cfg: Config, barge_in: bool):
    pipeline, bridge = build_pipeline(local_transport(), cfg, barge_in=barge_in)

    @bridge.event_handler("on_mouth_lost")
    async def on_mouth_lost(bridge, reason):
        logger.warning(f"no mouth ({reason}); still listening, transcripts are dropped until the brain is back")

    runner = WorkerRunner(handle_sigint=True)
    await runner.add_workers(make_worker(pipeline))
    logger.info("listening on the laptop mic; Ctrl-C to stop")
    await runner.run()


# ---- webrtc: a phone (or laptop) browser -------------------------------------------------------------------


def webrtc_params() -> TransportParams:
    return TransportParams(audio_in_enabled=True, audio_out_enabled=True)


def make_app(cfg: Config, barge_in: bool):
    """Signaling for SmallWebRTCTransport, speaking the same routes as Pipecat's dev runner so the prebuilt
    client works unchanged: POST /start, then POST/PATCH /sessions/<id>/api/offer (also plain /api/offer).
    One bodycam at a time: a new connection ends the previous session."""
    from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import RedirectResponse
    from pipecat_ai_small_webrtc_prebuilt.frontend import SmallWebRTCPrebuiltUI

    from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
    from pipecat.transports.smallwebrtc.request_handler import (
        IceCandidate,
        SmallWebRTCPatchRequest,
        SmallWebRTCRequest,
        SmallWebRTCRequestHandler,
    )
    from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

    # By default no ICE servers: on one Wi-Fi (or the phone's hotspot) host candidates connect directly.
    # ICE_SERVERS (e.g. a TURN relay) is used by both peers: the worker here, the browser through /start.
    ice_servers = [IceServer(**server) for server in cfg.ice_servers]
    handler = SmallWebRTCRequestHandler(ice_servers=ice_servers or None)
    sessions: set[str] = set()
    active: dict[str, PipelineWorker | None] = {"worker": None}

    async def run_session(connection: SmallWebRTCConnection):
        if previous := active["worker"]:
            logger.info("new bodycam connection; ending the previous session")
            await previous.cancel()
        transport = SmallWebRTCTransport(webrtc_connection=connection, params=webrtc_params())
        pipeline, bridge = build_pipeline(transport, cfg, barge_in=barge_in)
        worker = make_worker(pipeline)
        active["worker"] = worker

        @transport.event_handler("on_client_connected")
        async def on_connected(transport, client):
            logger.info("bodycam connected")

        @transport.event_handler("on_client_disconnected")
        async def on_disconnected(transport, client):
            logger.info("bodycam disconnected")
            await worker.cancel()

        # A link without a working mouth would keep the phone silent while nobody speaks the callouts (B11):
        # end the session so the phone takes over.
        @bridge.event_handler("on_mouth_lost")
        async def on_mouth_lost(bridge, reason):
            logger.warning(f"no mouth ({reason}); ending the session so the phone speaks callouts itself")
            await worker.cancel()

        runner = WorkerRunner(handle_sigint=False)
        await runner.add_workers(worker)
        try:
            await runner.run()
        finally:
            if active["worker"] is worker:
                active["worker"] = None

    @asynccontextmanager
    async def lifespan(app):
        yield
        await handler.close()

    app = FastAPI(lifespan=lifespan)
    # The real bodycam page is served from another origin (Vite, or the deployed site).
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.mount("/client", SmallWebRTCPrebuiltUI)

    @app.get("/", include_in_schema=False)
    async def root():
        return RedirectResponse(url="/client/")

    @app.post("/start")
    async def start(request: Request):
        try:
            body = await request.json()
        except ValueError:
            body = {}
        session_id = str(uuid.uuid4())
        sessions.add(session_id)
        result: dict = {"sessionId": session_id}
        if cfg.ice_servers:
            result["iceConfig"] = {"iceServers": cfg.ice_servers}
        elif body.get("enableDefaultIceServers"):
            result["iceConfig"] = {"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]}
        return result

    async def offer(data: dict, background_tasks: BackgroundTasks):
        request = SmallWebRTCRequest(
            sdp=data["sdp"],
            type=data["type"],
            pc_id=data.get("pc_id"),
            restart_pc=data.get("restart_pc"),
            request_data=data.get("request_data") or data.get("requestData"),
        )

        async def on_new_connection(connection: SmallWebRTCConnection):
            background_tasks.add_task(run_session, connection)

        return await handler.handle_web_request(request=request, webrtc_connection_callback=on_new_connection)

    async def ice_candidates(data: dict):
        await handler.handle_patch_request(
            SmallWebRTCPatchRequest(
                pc_id=data["pc_id"], candidates=[IceCandidate(**c) for c in data.get("candidates", [])]
            )
        )
        return {"status": "success"}

    @app.post("/api/offer")
    async def post_offer(request: Request, background_tasks: BackgroundTasks):
        return await offer(await request.json(), background_tasks)

    @app.patch("/api/offer")
    async def patch_offer(request: Request):
        return await ice_candidates(await request.json())

    @app.api_route("/sessions/{session_id}/api/offer", methods=["POST", "PATCH"])
    async def session_offer(session_id: str, request: Request, background_tasks: BackgroundTasks):
        if session_id not in sessions:
            raise HTTPException(404, "unknown session_id; POST /start first")
        data = await request.json()
        if request.method == "PATCH":
            return await ice_candidates(data)
        return await offer(data, background_tasks)

    return app


def run_webrtc(cfg: Config, args):
    import uvicorn

    from certs import ensure_self_signed, lan_ip

    ssl = {}
    if args.ssl_cert and args.ssl_key:
        ssl = {"ssl_certfile": args.ssl_cert, "ssl_keyfile": args.ssl_key}
    elif args.ssl:
        cert, key = ensure_self_signed()
        ssl = {"ssl_certfile": str(cert), "ssl_keyfile": str(key)}
    scheme = "https" if ssl else "http"

    ip = lan_ip()
    print(f"\n  Handoff voice worker (WebRTC). Brain: {cfg.brain_url}. Voice: {cfg.voice}")
    print(f"  This laptop:  {scheme}://localhost:{args.port}/client")
    if ip:
        print(f"  Phone:        {scheme}://{ip}:{args.port}/client", end="")
        print("" if ssl else "   (needs --ssl: phones only allow the mic on https)")
    print()
    uvicorn.run(make_app(cfg, not args.no_barge_in), host=args.host, port=args.port, **ssl)


# ---- --check ------------------------------------------------------------------------------------------------


async def check(cfg: Config, barge_in: bool) -> int:
    """Construct everything with a dummy key. Nothing connects: services open their gRPC streams and the bridge
    its brain connection only when a pipeline starts, which this never does."""
    from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
    from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

    print(f"pipecat-ai {version('pipecat-ai')}, nvidia-riva-client {version('nvidia-riva-client')}")
    print(f"NVIDIA_API_KEY (env or voice/.env.local): {cfg.masked_key()}")
    print(f"voice {cfg.voice} · brain {cfg.brain_url} · ASR {cfg.asr_model} ({cfg.asr_function_id}) · TTS fn {cfg.tts_function_id}")
    if cfg.boost_words:
        print(f"ASR word boost: {', '.join(cfg.boost_words)}")
    if cfg.ice_servers:
        print(f"ICE servers: {', '.join(str(s.get('urls')) for s in cfg.ice_servers)}")
    dummy = replace(cfg, api_key="nvapi-check-dummy-key")

    connection = SmallWebRTCConnection()
    transport = SmallWebRTCTransport(webrtc_connection=connection, params=webrtc_params())
    pipeline, _ = build_pipeline(transport, dummy, barge_in=barge_in)
    make_worker(pipeline)
    print("webrtc pipeline: " + " → ".join(p.name for p in pipeline.processors))
    app = make_app(dummy, barge_in)
    routes = sorted({getattr(r, "path", "") for r in app.routes} - {""})
    print(f"webrtc server routes: {', '.join(routes)}")
    await connection.disconnect()

    try:
        import pyaudio  # noqa: F401
    except ImportError:
        print("local pipeline: SKIPPED, PyAudio not installed (brew install portaudio, then see README)")
    else:
        pipeline, _ = build_pipeline(local_transport(), dummy, barge_in=barge_in)
        make_worker(pipeline)
        print("local pipeline: " + " → ".join(p.name for p in pipeline.processors))

    if not cfg.has_key:
        print("note: no nvapi- key found; the worker will build but NVIDIA ASR/TTS will refuse to connect")
    print("check OK")
    return 0


def list_voices(cfg: Config) -> int:
    """Ask the hosted TTS which voices it has (the same config call NvidiaTTSService makes at startup)."""
    import grpc
    import riva.client
    import riva.client.proto.riva_tts_pb2 as rtts

    metadata = [["function-id", cfg.tts_function_id], ["authorization", f"Bearer {cfg.api_key}"]]
    service = riva.client.SpeechSynthesisService(riva.client.Auth(None, True, NVIDIA_SPEECH_SERVER, metadata))
    try:
        config = service.stub.GetRivaSynthesisConfig(rtts.RivaSynthesisConfigRequest())
    except grpc.RpcError as e:
        print(f"TTS config request failed: {e.code().name}: {e.details()}")
        return 1
    for model in config.model_config:
        params = dict(model.parameters)
        base = params.get("voice_name", model.model_name)
        subvoices = [s.split(":")[0] for s in params.get("subvoices", "").split(",") if s]
        names = [f"{base}.{s}" for s in subvoices] or [base]
        print(f"{params.get('language_code', '?')}: {', '.join(names)}")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-t", "--transport", choices=["webrtc", "local"], default="webrtc")
    parser.add_argument("--host", default="0.0.0.0", help="webrtc: interface to listen on (default all)")
    parser.add_argument("--port", type=int, default=7860, help="webrtc: port (default 7860)")
    parser.add_argument("--ssl", action="store_true", help="webrtc: serve https with a self-signed cert")
    parser.add_argument("--ssl-cert", help="webrtc: your own cert (e.g. from mkcert) instead of self-signed")
    parser.add_argument("--ssl-key", help="webrtc: key for --ssl-cert")
    parser.add_argument(
        "--no-barge-in",
        action="store_true",
        help="laptop speakers only, never the demo: the agent keeps talking when the medic speaks",
    )
    parser.add_argument("--check", action="store_true", help="build the pipelines with a dummy key and exit")
    parser.add_argument("--list-voices", action="store_true", help="print the hosted TTS voices (needs the key)")
    args = parser.parse_args()

    cfg = load_config()
    barge_in = not args.no_barge_in

    if args.check:
        sys.exit(asyncio.run(check(cfg, barge_in)))
    if args.list_voices:
        sys.exit(list_voices(cfg))
    if not cfg.has_key:
        logger.warning("NVIDIA_API_KEY is missing or not an nvapi- key: ASR and TTS will fail to connect")
    if args.transport == "local":
        asyncio.run(run_local(cfg, barge_in))
    else:
        run_webrtc(cfg, args)


if __name__ == "__main__":
    main()
