"""The session video (decision 28): chunks of the phone's camera and mic recording, saved on this laptop.

The phone (hub/phone.html) records in clips and POSTs each chunk, in order, to /api/recording?clip=&seq=&ext=.
Chunk 0 starts the file; every chunk is appended. The files land in web/public/recordings, which the dashboard
serves at /recordings/<clip>.<ext>. After each chunk the brain (voice/src/recording.ts) decides: attach the clip to
the open call, start a new clip (the call ended or changed), or delete it (it never belonged to a call).
"""

import asyncio
import os
import re
from pathlib import Path
from typing import Awaitable, Callable

from loguru import logger

RECORDINGS_DIR = Path(os.environ.get("RECORDINGS_DIR") or Path(__file__).resolve().parent.parent.parent / "web" / "public" / "recordings")
MAX_CHUNK_BYTES = 16 * 1024 * 1024
CLIP = re.compile(r"^[a-zA-Z0-9_-]{8,80}$")

AskBrain = Callable[[str, str, int], Awaitable[dict]]


class ClipStore:
    def __init__(self, ask_brain: AskBrain, directory: Path = RECORDINGS_DIR):
        self.ask_brain, self.dir = ask_brain, directory
        self.next: dict[str, int] = {}
        self.lock = asyncio.Lock()

    async def save(self, clip: str, seq: int, ext: str, data: bytes) -> tuple[int, dict]:
        """Returns (HTTP status, JSON body). A chunk out of order is refused: the phone starts a new clip."""
        if not CLIP.match(clip) or ext not in ("webm", "mp4") or seq < 0:
            return 400, {"error": "clip (8-80 of a-z A-Z 0-9 _ -), seq >= 0 and ext webm|mp4 required"}
        if not data or len(data) > MAX_CHUNK_BYTES:
            return 413, {"error": f"chunk must be 1 byte to {MAX_CHUNK_BYTES} bytes"}
        path = self.dir / f"{clip}.{ext}"
        async with self.lock:
            expected = self.next.get(clip, 0)
            if seq != expected:
                return 409, {"error": "out of order", "expected": expected, "restart": True}
            await asyncio.to_thread(self._write, path, data, seq == 0)
            self.next[clip] = seq + 1
        try:
            reply = await self.ask_brain(clip, f"/recordings/{path.name}", seq)
        except Exception as e:  # the brain down must not lose footage; the clip attaches on a later chunk
            logger.warning(f"session video: brain unreachable ({e!r}); chunk {seq} of {clip} kept")
            reply = {"incident": None, "restart": False, "discard": False}
        if reply.get("discard"):
            async with self.lock:
                self.next.pop(clip, None)
                await asyncio.to_thread(path.unlink, True)
            logger.info(f"session video: {clip} never belonged to a call; deleted")
        elif reply.get("restart"):
            async with self.lock:
                self.next.pop(clip, None)
            logger.info(f"session video: {clip} finished ({seq + 1} chunks)")
        return 200, {"incident": reply.get("incident"), "restart": bool(reply.get("restart"))}

    def _write(self, path: Path, data: bytes, first: bool) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        with open(path, "wb" if first else "ab") as fh:
            fh.write(data)
