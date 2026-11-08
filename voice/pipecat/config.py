"""Settings for the Pipecat worker.

Each setting comes from the environment first, then from voice/.env.local (the same gitignored KEY=VALUE file
the brain reads). Only the keys below are read; the rest of .env.local is the brain's business.
"""

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import dotenv_values

ENV_FILE = Path(__file__).resolve().parent.parent / ".env.local"

# NVIDIA's hosted speech runs as NVCF functions behind one gRPC endpoint; the function id picks the model.
# These are Pipecat 1.15.0's defaults. NVIDIA changes an id when it redeploys a model: the current one is on the
# model's build.nvidia.com page (".../api" tab), and RIVA_ASR_FUNCTION_ID / RIVA_TTS_FUNCTION_ID override them.
NVIDIA_SPEECH_SERVER = "grpc.nvcf.nvidia.com:443"
ASR_FUNCTION_ID = "1598d209-5e27-4d3c-8079-4751568b1081"  # parakeet-ctc-1.1b-asr
# Words Riva keeps mishearing at the demo table ("epi IO" came back as "FPIO" and "FEO"). Boosted by default;
# RIVA_BOOST_WORDS overrides the list, RIVA_BOOST_WORDS="" turns it off.
DEFAULT_BOOST_WORDS = (
    "epi, epinephrine, adrenaline, amio, amiodarone, naloxone, Narcan, nitro, bicarb, atropine, adenosine, "
    "intraosseous, intravenous, intramuscular, intranasal, sublingual, milligram, milligrams, micrograms, joules, "
    "i-gel, airway, ROSC, pulse, compressions, shock, defib, correction, confirm, Handoff, Jordan Avery"
)
# Default ASR: Parakeet CTC 1.1B (streaming-capable). nemotron-asr-streaming (bb0837de-8c7b-481f-9ec8-ef5663e9c1fa,
# model "nemotron-asr-streaming") was the first choice but mangled drug names badly in a noisy room (Sat 22:10).
# Override with RIVA_ASR_FUNCTION_ID + RIVA_ASR_MODEL.
ASR_MODEL = "parakeet-ctc-1.1b-asr"
TTS_FUNCTION_ID = "877104f7-e885-42b9-8de8-f6e4c6303969"  # magpie-tts-multilingual
TTS_MODEL = "magpie-tts-multilingual"
DEFAULT_VOICE = "Magpie-Multilingual.EN-US.Aria"

# Vision (spec §19 Vision): a hosted Nemotron vision model on the same key, through NVIDIA's OpenAI-compatible
# endpoint. The Nano Omni is the model Devin's PR #6 ran self-hosted with this prompt; `nvidia/nemotron-3.5-super-vl-120b-a12b`
# also read the synthetic ID card correctly (both about 1.4 s a frame, Sat ~23:05). VISION_MODEL overrides.
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
VISION_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"


@dataclass
class Config:
    api_key: str
    voice: str
    brain_url: str
    asr_function_id: str
    asr_model: str
    tts_function_id: str
    tts_provider: str = "nvidia"
    elevenlabs_api_key: str = field(default="", repr=False)
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"  # George, stock voice
    elevenlabs_model: str = "eleven_flash_v2_5"
    boost_words: list[str] = field(default_factory=list)
    # WebRTC ICE servers for both peers, e.g. a TURN relay when the venue Wi-Fi blocks device-to-device traffic
    ice_servers: list[dict] = field(default_factory=list)
    # Vision: off = audio only. VISION defaults to on; it needs the key like everything else.
    vision: bool = True
    vision_model: str = VISION_MODEL
    vision_base_url: str = NVIDIA_BASE_URL
    vision_api_key: str = ""  # defaults to api_key; set VISION_API_KEY for a second key (rate limit, §28)
    vision_interval_s: float = 1.0
    # The Pi hub (hub/hub.py), for vision frames when no WebRTC video arrives, and to serve the phone page's
    # hub calls from the worker's own origin (one https URL for the phone). Empty = off.
    hub_url: str = ""

    @property
    def has_key(self) -> bool:
        return self.api_key.startswith("nvapi-")

    def masked_key(self) -> str:
        if not self.api_key:
            return "missing"
        return f"{self.api_key[:8]}… ({len(self.api_key)} chars)"


def load_config() -> Config:
    file_values = dotenv_values(ENV_FILE) if ENV_FILE.exists() else {}

    def get(name: str, default: str = "") -> str:
        value = os.environ.get(name) or file_values.get(name) or default
        return value.strip()

    boost_raw = os.environ.get("RIVA_BOOST_WORDS")
    if boost_raw is None:
        boost_raw = file_values.get("RIVA_BOOST_WORDS")
    boost = DEFAULT_BOOST_WORDS if boost_raw is None else boost_raw
    # ICE_SERVERS='[{"urls": "turn:host:3478", "username": "u", "credential": "p"}]' (JSON, as in RTCIceServer)
    ice = get("ICE_SERVERS")
    try:
        ice_servers = json.loads(ice) if ice else []
        assert isinstance(ice_servers, list) and all(isinstance(s, dict) and "urls" in s for s in ice_servers)
    except (ValueError, AssertionError):
        raise SystemExit(f"ICE_SERVERS must be a JSON list of {{urls, username?, credential?}}, got {ice!r}")
    # The short form for one TURN relay (coturn): TURN_URL=turn:host:3478 TURN_USER=u TURN_PASS=p
    if get("TURN_URL"):
        ice_servers.append({"urls": get("TURN_URL"), "username": get("TURN_USER"), "credential": get("TURN_PASS")})
    try:
        vision_interval = float(get("VISION_INTERVAL_S", "1.0"))
    except ValueError:
        raise SystemExit(f"VISION_INTERVAL_S must be a number of seconds, got {get('VISION_INTERVAL_S')!r}")
    elevenlabs_key = get("ELEVENLABS_API_KEY")
    tts_provider = get("TTS_PROVIDER", "elevenlabs" if elevenlabs_key else "nvidia").lower()
    if tts_provider not in ("nvidia", "elevenlabs"):
        raise SystemExit("TTS_PROVIDER must be nvidia or elevenlabs")
    if tts_provider == "elevenlabs" and not elevenlabs_key:
        raise SystemExit("ELEVENLABS_API_KEY is required when TTS_PROVIDER=elevenlabs")
    return Config(
        tts_provider=tts_provider,
        elevenlabs_api_key=elevenlabs_key,
        elevenlabs_voice_id=get("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb"),
        elevenlabs_model=get("ELEVENLABS_MODEL", "eleven_flash_v2_5"),
        api_key=get("NVIDIA_API_KEY"),
        voice=get("RIVA_VOICE", DEFAULT_VOICE),
        brain_url=get("BRAIN_URL", "http://127.0.0.1:8787").rstrip("/"),
        asr_function_id=get("RIVA_ASR_FUNCTION_ID", ASR_FUNCTION_ID),
        asr_model=get("RIVA_ASR_MODEL", ASR_MODEL),
        tts_function_id=get("RIVA_TTS_FUNCTION_ID", TTS_FUNCTION_ID),
        boost_words=[w.strip() for w in boost.split(",") if w.strip()],
        ice_servers=ice_servers,
        vision=get("VISION", "on").lower() not in ("off", "0", "false", "no"),
        vision_model=get("VISION_MODEL", VISION_MODEL),
        vision_base_url=get("VISION_BASE_URL", get("NVIDIA_BASE_URL", NVIDIA_BASE_URL)).rstrip("/"),
        vision_api_key=get("VISION_API_KEY"),
        vision_interval_s=vision_interval,
        hub_url=get("HUB_URL").rstrip("/"),
    )
