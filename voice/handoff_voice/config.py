import os

from dotenv import load_dotenv

load_dotenv()


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


NVIDIA_API_KEY = env("NVIDIA_API_KEY")
ASR_FUNCTION_ID = env("ASR_FUNCTION_ID", "bb0837de-8c7b-481f-9ec8-ef5663e9c1fa")
ASR_STOP_HISTORY_MS = int(env("ASR_STOP_HISTORY_MS", "300"))
ASR_STOP_HISTORY_EOU_MS = int(env("ASR_STOP_HISTORY_EOU_MS", "240"))

OMNI_BASE_URL = env("OMNI_BASE_URL", "http://localhost:8001/v1").rstrip("/")
OMNI_MODEL = env("OMNI_MODEL", "omni")
OMNI_API_KEY = env("OMNI_API_KEY", "none")

KOKORO_BASE_URL = env("KOKORO_BASE_URL", "http://localhost:8880/v1").rstrip("/")
KOKORO_VOICE = env("KOKORO_VOICE", "af_heart")

SPACETIMEDB_HOST = env("SPACETIMEDB_HOST", "http://127.0.0.1:3000").rstrip("/")
SPACETIMEDB_DB_NAME = env("SPACETIMEDB_DB_NAME", "handoff-local")

EHR_BASE_URL = env("EHR_BASE_URL", "http://localhost:4100/fhir").rstrip("/")
HUB_URL = env("HUB_URL").rstrip("/")

PORT = int(env("VOICE_PORT", "7860"))
# TURN relay, needed when the phone and the worker can't reach each other directly (different NATs).
TURN_URL = env("TURN_URL")
TURN_USER = env("TURN_USER")
TURN_PASS = env("TURN_PASS")
VISION_INTERVAL_S = float(env("VISION_INTERVAL_S", "1.0"))
VISION_MIN_CONFIDENCE = 0.7
EVIDENCE_DIR = env("EVIDENCE_DIR", "evidence")

REPLY_MAX_WORDS = 15
PROACTIVE_MAX_WORDS = 8
PROACTIVE_GAP_S = 20.0
CALLOUT_GAP_S = 4.0
REPEAT_WINDOW_S = 30.0
