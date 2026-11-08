"""End-to-end check of the voice worker over real WebRTC (aiortc), without a phone.

Plays medic utterances (WAV files) as the mic and a still image as the camera, records what Handoff says, and
prints, per utterance, the time from the end of the medic's speech to the first audio back.

  python test_client.py --url http://localhost:7860 --image id.jpg --switch-image-at 3 --other-image noid.jpg a.wav b.wav ...
"""
import argparse
import asyncio
import fractions
import time
import wave

import httpx
import numpy as np
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription
from av import AudioFrame, VideoFrame
from PIL import Image

RATE, SAMPLES = 48000, 960  # 20 ms frames


def load_wav(path: str) -> np.ndarray:
    with wave.open(path) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        if w.getnchannels() == 2:
            data = data[::2]
        rate = w.getframerate()
    idx = np.arange(0, len(data), rate / RATE)
    return np.interp(idx, np.arange(len(data)), data).astype(np.int16)


class Mic(MediaStreamTrack):
    kind = "audio"

    def __init__(self):
        super().__init__()
        self._pts = 0
        self._buf = np.zeros(0, dtype=np.int16)
        self._start = None

    async def recv(self):
        if self._start is None:
            self._start = time.time()
        target = self._start + self._pts / RATE
        await asyncio.sleep(max(0, target - time.time()))
        if len(self._buf) < SAMPLES:
            self._buf = np.concatenate([self._buf, np.zeros(SAMPLES * 50, np.int16)])
        chunk, self._buf = self._buf[:SAMPLES], self._buf[SAMPLES:]
        frame = AudioFrame.from_ndarray(chunk.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate, frame.pts, frame.time_base = RATE, self._pts, fractions.Fraction(1, RATE)
        self._pts += SAMPLES
        return frame


class Cam(MediaStreamTrack):
    kind = "video"

    def __init__(self, path: str):
        super().__init__()
        self.set(path)
        self._pts = 0

    def set(self, path: str):
        self.img = np.asarray(Image.open(path).convert("RGB").resize((960, 540)))

    async def recv(self):
        await asyncio.sleep(0.1)
        frame = VideoFrame.from_ndarray(self.img, format="rgb24")
        frame.pts, frame.time_base = self._pts, fractions.Fraction(1, 90000)
        self._pts += 9000
        return frame


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:7860")
    ap.add_argument("--image", required=True)
    ap.add_argument("--other-image")
    ap.add_argument("--switch-image-at", type=int, default=-1, help="utterance index that switches to --other-image")
    ap.add_argument("--gap", type=float, default=9.0)
    ap.add_argument("--out", default="test-out/handoff.wav")
    ap.add_argument("wavs", nargs="+")
    a = ap.parse_args()

    clips = [load_wav(p) for p in a.wavs]
    # Mic plays: 1.5 s silence, clip 0, gap, clip 1, ...  End of clip i = time it finished playing.
    mic, cam = Mic(), Cam(a.image)
    timeline = []
    t = 1.5
    for c in clips:
        t += len(c) / RATE
        timeline.append(t)
        t += a.gap
    mic._buf = np.concatenate([np.zeros(int(RATE * 1.5), np.int16)] + sum(
        [[c, np.zeros(int(RATE * a.gap), np.int16)] for c in clips], []))

    pc = RTCPeerConnection()
    pc.addTrack(mic)
    pc.addTrack(cam)
    received: list[tuple[float, np.ndarray]] = []

    @pc.on("track")
    def on_track(track):
        async def pull():
            while True:
                try:
                    f = await track.recv()
                except Exception:
                    return
                if track.kind == "audio":
                    arr = f.to_ndarray().reshape(-1)
                    if f.layout.name == "stereo":
                        arr = arr[::2]
                    received.append((time.time(), arr.astype(np.int16)))
        asyncio.create_task(pull())

    await pc.setLocalDescription(await pc.createOffer())
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{a.url}/api/offer", json={"sdp": pc.localDescription.sdp, "type": pc.localDescription.type})
        ans = r.json()
    await pc.setRemoteDescription(RTCSessionDescription(sdp=ans["sdp"], type=ans["type"]))
    while mic._start is None:
        await asyncio.sleep(0.05)
    t0 = mic._start
    for i, end in enumerate(timeline):
        if i == a.switch_image_at and a.other_image:
            await asyncio.sleep(max(0, t0 + end - len(clips[i]) / RATE - 1 - time.time()))
            cam.set(a.other_image)
        await asyncio.sleep(max(0, t0 + end + a.gap - 0.5 - time.time()))
    await asyncio.sleep(2)

    for i, end in enumerate(timeline):
        stop, nxt = t0 + end, t0 + end + a.gap
        first = next((ts for ts, arr in received if stop < ts < nxt and np.abs(arr).mean() > 300), None)
        print(f"utterance {i + 1} ({a.wavs[i]}): " + (f"first reply audio {1000 * (first - stop):.0f} ms after speech end" if first else "no reply audio"))
    if received:
        import os
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        with wave.open(a.out, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
            w.writeframes(np.concatenate([arr for _, arr in received]).tobytes())
    await pc.close()


if __name__ == "__main__":
    asyncio.run(main())
