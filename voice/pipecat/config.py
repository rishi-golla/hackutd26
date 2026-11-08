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
ASR_FUNCTION_ID = "bb0837de-8c7b-481f-9ec8-ef5663e9c1fa"  # nemotron-asr-streaming
ASR_MODEL = "nemotron-asr-streaming"
TTS_FUNCTION_ID = "877104f7-e885-42b9-8de8-f6e4c6303969"  # magpie-tts-multilingual
TTS_MODEL = "magpie-tts-multilingual"
DEFAULT_VOICE = "Magpie-Multilingual.EN-US.Aria"


@dataclass
class Config:
    api_key: str
    voice: str
    brain_url: str
    asr_function_id: str
    tts_function_id: str
    boost_words: list[str] = field(default_factory=list)
    # WebRTC ICE servers for both peers, e.g. a TURN relay when the venue Wi-Fi blocks device-to-device traffic
    ice_servers: list[dict] = field(default_factory=list)

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

    boost = get("RIVA_BOOST_WORDS")
    # ICE_SERVERS='[{"urls": "turn:host:3478", "username": "u", "credential": "p"}]' (JSON, as in RTCIceServer)
    ice = get("ICE_SERVERS")
    try:
        ice_servers = json.loads(ice) if ice else []
        assert isinstance(ice_servers, list) and all(isinstance(s, dict) and "urls" in s for s in ice_servers)
    except (ValueError, AssertionError):
        raise SystemExit(f"ICE_SERVERS must be a JSON list of {{urls, username?, credential?}}, got {ice!r}")
    return Config(
        api_key=get("NVIDIA_API_KEY"),
        voice=get("RIVA_VOICE", DEFAULT_VOICE),
        brain_url=get("BRAIN_URL", "http://127.0.0.1:8787").rstrip("/"),
        asr_function_id=get("RIVA_ASR_FUNCTION_ID", ASR_FUNCTION_ID),
        tts_function_id=get("RIVA_TTS_FUNCTION_ID", TTS_FUNCTION_ID),
        boost_words=[w.strip() for w in boost.split(",") if w.strip()],
        ice_servers=ice_servers,
    )
