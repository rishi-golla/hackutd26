"""Minimal OpenAI-compatible Kokoro TTS server: POST /v1/audio/speech streams 24 kHz mono s16le PCM."""
import numpy as np
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from kokoro import KPipeline

pipe = KPipeline(lang_code="a", device="cuda")
list(pipe("Ready.", voice="af_heart"))  # warm up
app = FastAPI()


@app.post("/v1/audio/speech")
def speech(req: dict):
    text, voice, speed = req["input"], req.get("voice", "af_heart"), float(req.get("speed") or 1.0)

    def gen():
        for _, _, audio in pipe(text, voice=voice, speed=speed):
            a = audio.cpu().numpy() if hasattr(audio, "cpu") else np.asarray(audio)
            yield (np.clip(a, -1, 1) * 32767).astype("<i2").tobytes()

    return StreamingResponse(gen(), media_type="audio/pcm")


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": "kokoro", "object": "model"}]}
