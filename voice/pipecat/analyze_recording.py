"""Trace a recorded bodycam video offline: what was said (Riva ASR) and seen (Nemotron vision), at video times.

The output goes to a video-only import (`demo_control("import_recording")`) through
`demo_control("recording_trace", JSON)`: transcript rows, seen_* / said_* timeline events and analyzer steps,
each at `t` seconds into the video. A rerun replaces the previous analysis. Live care is never touched.

    python analyze_recording.py ../../web/public/recordings/patient-1000039274.mp4 \
        --url /recordings/patient-1000039274.mp4 --label "Recorded patient 01"

Defaults to Maincloud (handoff-hackutd26); --host http://127.0.0.1:3000 --db handoff-local for a local database.
--out trace.json keeps the analysis; --from-json trace.json writes a saved one without calling NVIDIA again;
--dry-run prints it and writes nothing. Needs ffmpeg on PATH, `pip install nvidia-riva-client`, and NVIDIA_API_KEY
(environment or voice/.env.local).
"""

import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
NVIDIA_SPEECH_SERVER = "grpc.nvcf.nvidia.com:443"
ASR_FUNCTION_ID = "1598d209-5e27-4d3c-8079-4751568b1081"  # parakeet-ctc-1.1b-asr, as in config.py
ASR_MODEL = "parakeet-ctc-1.1b-asr"
VISION_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
TEXT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b"
ENV_FILE = Path(__file__).resolve().parent.parent / ".env.local"
ASR_CHUNK_S = 50  # offline recognition per request stays well under the service's audio limit

PROMPT = """You see one frame from a paramedic's bodycam recording. The camera is worn by the medic: hands and arms in view are
the medic's, and the person lying down is the patient. Report only what is clearly visible. Return JSON only:
{"scene": "<one short sentence saying what the medic is doing to or near the patient; empty if nothing useful is visible>", "findings": [ ... ]}
where each finding is one of
{"type": "id_card", "confidence": 0-1}
{"type": "medication", "drug": "<generic name, lowercase>", "being_given": true|false, "confidence": 0-1}
{"type": "chest_compressions", "confidence": 0-1}        (the medic's hands on the patient's chest, pushing down)
{"type": "responsiveness_check", "confidence": 0-1}      (waving at, tapping or calling the patient)
{"type": "aed_pads", "confidence": 0-1}
{"type": "airway_device", "confidence": 0-1}
{"type": "oxygen", "confidence": 0-1}
{"type": "iv_io", "confidence": 0-1}
The scene describes actions, positions and equipment only: no names, no printed text, no one but the medic and the patient.
If nothing relevant is visible, the findings list is empty. Never guess."""

SAID_PROMPT = """You read a paramedic's bodycam transcript, one line per utterance with its time in seconds.
List the care actions or status changes the medic states (e.g. starting chest compressions, patient breathing again,
oxygen applied, a drug given, a device attached). Use only what is said; do not infer anything that is not stated.
Return JSON only: {"events": [{"t": <seconds of the line>, "label": "<short plain label, at most 8 words>"}]}.
Return {"events": []} when nothing like that is said."""

SEEN_LABEL = {
    "id_card": "ID card shown to the camera",
    "chest_compressions": "Chest compressions",
    "responsiveness_check": "Responsiveness check",
    "aed_pads": "AED pads on",
    "airway_device": "Airway device in place",
    "oxygen": "Oxygen",
    "iv_io": "IV or IO access",
}
# The same finding again within this many seconds is the same moment, not a new event.
REPEAT_GAP_S = 10.0


def mmss(t: float) -> str:
    return f"{int(t) // 60}:{int(t) % 60:02d}"


def api_key() -> str:
    key = os.environ.get("NVIDIA_API_KEY", "")
    if not key and ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.strip().startswith("NVIDIA_API_KEY="):
                key = line.split("=", 1)[1]
    key = key.strip().strip('"').removeprefix("NVIDIA_API_KEY=")
    if not key:
        sys.exit("NVIDIA_API_KEY is not set (environment or voice/.env.local)")
    return key


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def duration(video: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
                         check=True, capture_output=True, text=True).stdout
    return float(out.strip())


def chat(key: str, body: dict, timeout: float = 60) -> str:
    req = urllib.request.Request(f"{NVIDIA_BASE_URL}/chat/completions", data=json.dumps(body).encode(), headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                content = json.load(r)["choices"][0]["message"]["content"] or ""
                return re.sub(r"<think>[\s\S]*?</think>", "", content).strip()
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3:
                raise RuntimeError(f"NVIDIA API {e.code}: {e.read()[:200]!r}") from e
            time.sleep(float(e.headers.get("Retry-After") or 5))
    raise RuntimeError("unreachable")


def json_object(text: str) -> dict:
    """The first JSON object in the model's text (tolerates code fences and prose around it)."""
    start = text.find("{")
    if start < 0:
        raise ValueError(f"no JSON in {text[:120]!r}")
    return json.JSONDecoder().raw_decode(text[start:])[0]


def transcribe(key: str, video: Path, tmp: Path, length: float) -> list[dict]:
    import riva.client  # pip install nvidia-riva-client

    auth = riva.client.Auth(use_ssl=True, uri=NVIDIA_SPEECH_SERVER, metadata_args=[
        ["function-id", ASR_FUNCTION_ID], ["authorization", f"Bearer {key}"]])
    asr = riva.client.ASRService(auth)
    cfg = riva.client.RecognitionConfig(
        encoding=riva.client.AudioEncoding.LINEAR_PCM, sample_rate_hertz=16000, language_code="en-US",
        max_alternatives=1, enable_automatic_punctuation=True, enable_word_time_offsets=True, audio_channel_count=1)
    lines = []
    start = 0.0
    while start < length:
        wav = tmp / f"audio_{int(start)}.wav"
        ffmpeg("-ss", str(start), "-t", str(ASR_CHUNK_S), "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", str(wav))
        for result in asr.offline_recognize(wav.read_bytes(), cfg).results:
            alt = result.alternatives[0] if result.alternatives else None
            text = (alt.transcript if alt else "").strip()
            if text and alt.words:
                lines.append({"t": round(start + alt.words[0].start_time / 1000, 1), "text": text})
        start += ASR_CHUNK_S
    return lines


def look(key: str, jpg: bytes) -> tuple[str, list[dict]]:
    reply = chat(key, {
        "model": VISION_MODEL, "temperature": 0, "max_tokens": 300,
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [{"role": "system", "content": PROMPT}, {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpg).decode()}},
            {"type": "text", "text": "Scene and findings JSON."}]}],
    })
    data = json_object(reply)
    scene = data.get("scene") if isinstance(data.get("scene"), str) else ""
    findings = [f for f in data.get("findings") or [] if isinstance(f, dict)]
    return " ".join(scene.split())[:160], findings


def said_events(key: str, lines: list[dict]) -> list[dict]:
    if not lines:
        return []
    corpus = "\n".join(f"{line['t']}: {line['text']}" for line in lines)
    data = json_object(chat(key, {
        "model": TEXT_MODEL, "temperature": 0, "max_tokens": 600,
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [{"role": "system", "content": SAID_PROMPT}, {"role": "user", "content": corpus}],
    }, timeout=120))
    known = {line["t"] for line in lines}
    out = []
    for e in data.get("events") or []:
        try:
            t = float(e["t"])
        except (KeyError, TypeError, ValueError):
            continue
        label = " ".join(str(e.get("label") or "").split())[:80]
        if label and t in known:  # only times of real transcript lines: the model cannot invent a moment
            line = next(l for l in lines if l["t"] == t)
            out.append({"t": t, "kind": "said_action", "label": f"Said: {label}",
                        "detail": f"video {mmss(t)} · from the transcript (\"{line['text'][:120]}\") · {TEXT_MODEL}"})
    return out


def analyze(key: str, video: Path, every: float, scene_every: float, min_conf: float) -> dict:
    length = duration(video)
    tmp = Path(tempfile.mkdtemp(prefix="trace_"))
    try:
        t0 = time.time()
        transcript = transcribe(key, video, tmp, length)
        print(f"ASR: {len(transcript)} lines in {time.time() - t0:.1f} s", file=sys.stderr)
        steps = [{"t": 0, "tool": "asr", "summary": f"Transcribed {mmss(length)} of audio with {ASR_MODEL}: {len(transcript)} lines"}]

        ffmpeg("-i", str(video), "-vf", f"fps=1/{every},scale=960:-2", "-q:v", "4", str(tmp / "f_%04d.jpg"))
        frames = sorted(tmp.glob("f_*.jpg"))
        events, last_seen, last_scene_t = [], {}, -1e9
        for i, frame in enumerate(frames):
            t = round(i * every, 1)
            try:
                scene, findings = look(key, frame.read_bytes())
            except (RuntimeError, ValueError) as e:
                steps.append({"t": t, "tool": "vision", "summary": f"video {mmss(t)}: frame not analyzed ({str(e)[:120]})"})
                continue
            if scene:
                steps.append({"t": t, "tool": "vision", "summary": f"video {mmss(t)}: {scene}"})
                if t - last_scene_t >= scene_every:
                    events.append({"t": t, "kind": "seen_scene", "label": f"Seen: {scene}",
                                   "detail": f"video {mmss(t)} · {VISION_MODEL}"})
                    last_scene_t = t
            for f in findings:
                kind, conf = str(f.get("type") or ""), float(f.get("confidence") or 0)
                if conf < min_conf:
                    continue
                if kind == "medication":
                    drug = str(f.get("drug") or "").strip().lower()
                    if not drug or not f.get("being_given"):
                        continue  # a label in view is not a dose given
                    key_, label = f"med:{drug}", f"{drug.capitalize()} being given"
                elif kind in SEEN_LABEL:
                    key_, label = kind, SEEN_LABEL[kind]
                else:
                    continue
                if t - last_seen.get(key_, -1e9) >= REPEAT_GAP_S:
                    events.append({"t": t, "kind": "seen_" + kind, "label": label,
                                   "detail": f"video {mmss(t)} · {VISION_MODEL} (confidence {conf:.2f})"})
                last_seen[key_] = t
            print(f"vision {mmss(t)}: {scene} {[f.get('type') for f in findings]}", file=sys.stderr)
        steps.append({"t": round(max(0.0, length - 0.1), 1), "tool": "vision",
                      "summary": f"Looked at {len(frames)} frames, one every {every:g} s, with {VISION_MODEL}"})

        said = said_events(key, transcript)
        events += said
        steps.append({"t": round(max(0.0, length - 0.1), 1), "tool": "transcript_events",
                      "summary": f"Read the transcript with {TEXT_MODEL}: {len(said)} stated actions"})
        return {"duration": round(length, 1), "analyzer": f"{ASR_MODEL} + {VISION_MODEL} + {TEXT_MODEL}",
                "transcript": transcript, "events": sorted(events, key=lambda e: e["t"]), "steps": steps}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def write(host: str, db: str, url: str, trace: dict) -> None:
    def post(path: str, body: bytes | None, token: str | None = None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        with urllib.request.urlopen(urllib.request.Request(f"{host}{path}", data=body, method="POST", headers=headers)) as r:
            raw = r.read()
            return json.loads(raw) if raw else None

    token = post("/v1/identity", None)["token"]
    arg = json.dumps({"url": url, **{k: trace[k] for k in ("transcript", "events", "steps")}})
    try:
        post(f"/v1/database/{db}/call/demo_control", json.dumps(["recording_trace", arg]).encode(), token)
    except urllib.error.HTTPError as e:
        sys.exit(f"recording_trace failed ({e.code}): {e.read()[:300]!r}. Import the video first (/controls → Add as new patient).")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video", nargs="?", type=Path, help="the video file (not needed with --from-json)")
    p.add_argument("--url", required=True, help="the imported recording's URL, e.g. /recordings/patient-01.mp4")
    p.add_argument("--host", default="https://maincloud.spacetimedb.com")
    p.add_argument("--db", default="handoff-hackutd26")
    p.add_argument("--every", type=float, default=2.0, help="seconds between analyzed frames")
    p.add_argument("--scene-every", type=float, default=6.0, help="at most one 'Seen:' timeline event per this many seconds")
    p.add_argument("--min-confidence", type=float, default=0.7)
    p.add_argument("--out", type=Path, help="also save the analysis as JSON")
    p.add_argument("--from-json", type=Path, help="write a saved analysis instead of analyzing again")
    p.add_argument("--dry-run", action="store_true", help="print the analysis, write nothing to the database")
    a = p.parse_args()

    if a.from_json:
        trace = json.loads(a.from_json.read_text())
    else:
        if not a.video or not a.video.exists():
            sys.exit("video file not found")
        trace = analyze(api_key(), a.video, a.every, a.scene_every, a.min_confidence)
    if a.out:
        a.out.write_text(json.dumps(trace, indent=2))
    if a.dry_run:
        print(json.dumps(trace, indent=2))
        return
    write(a.host.rstrip("/"), a.db, a.url, trace)
    print(f"Wrote {len(trace['transcript'])} transcript lines, {len(trace['events'])} events and "
          f"{len(trace['steps'])} steps to {a.db} for {a.url}")


if __name__ == "__main__":
    main()
