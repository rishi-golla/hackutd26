"""Offline test of the session video chunk store (recording.py) with a stub brain.

    .venv/bin/python test_recording.py
"""

import asyncio
import sys
import tempfile
from pathlib import Path

from recording import ClipStore


async def main() -> int:
    replies: list[dict] = []
    asked: list[tuple[str, str, int]] = []

    async def brain(clip: str, url: str, seq: int) -> dict:
        asked.append((clip, url, seq))
        return replies.pop(0) if replies else {"incident": "7", "restart": False, "discard": False}

    failures = []

    def check(name: str, ok: bool) -> None:
        print(("PASS " if ok else "FAIL ") + name)
        if not ok:
            failures.append(name)

    with tempfile.TemporaryDirectory() as tmp:
        store = ClipStore(brain, Path(tmp))
        clip = "clip-abc12345"
        check("chunk 0 starts the file", (await store.save(clip, 0, "webm", b"head"))[0] == 200)
        check("chunk 1 is appended", (await store.save(clip, 1, "webm", b"-tail"))[0] == 200)
        check("file holds both chunks in order", (Path(tmp) / f"{clip}.webm").read_bytes() == b"head-tail")
        check("brain is asked with the served path", asked[-1] == (clip, f"/recordings/{clip}.webm", 1))
        status, body = await store.save(clip, 5, "webm", b"x")
        check("a gap is refused with restart", status == 409 and body["restart"] and body["expected"] == 2)
        check("bad names and types are refused", (await store.save("../../etc", 0, "webm", b"x"))[0] == 400
              and (await store.save(clip, 0, "exe", b"x"))[0] == 400)

        replies.append({"incident": None, "restart": True, "discard": True})
        idle = "clip-idle0001"
        await store.save(idle, 0, "webm", b"idle")
        check("a clip the brain discards is deleted", not (Path(tmp) / f"{idle}.webm").exists())

        async def down(clip: str, url: str, seq: int) -> dict:
            raise ConnectionError("brain down")

        store.ask_brain = down
        status, body = await store.save("clip-down0001", 0, "webm", b"kept")
        check("brain down keeps the chunk", status == 200 and (Path(tmp) / "clip-down0001.webm").exists() and not body["restart"])

    print("all passed" if not failures else f"{len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
