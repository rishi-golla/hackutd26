"""Voice agent worker: FastAPI signaling for Pipecat's SmallWebRTC transport (no rtc_signal rows)."""
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)

from handoff_voice import clinical, config
from handoff_voice.bot import run_bot
from handoff_voice.state import StateWatcher
from handoff_voice.stdb import Stdb

stdb = Stdb(config.SPACETIMEDB_HOST, config.SPACETIMEDB_DB_NAME)
state = StateWatcher(stdb)
ehr = clinical.Ehr(config.EHR_BASE_URL)
handler = SmallWebRTCRequestHandler(ice_servers=[IceServer(urls="stun:stun.l.google.com:19302")])


@asynccontextmanager
async def lifespan(_app: FastAPI):
    state.start()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/")
async def index():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.post("/api/offer")
async def offer(request: SmallWebRTCRequest, background_tasks: BackgroundTasks):
    async def start(connection: SmallWebRTCConnection):
        background_tasks.add_task(run_bot, connection, stdb, state, ehr)

    return await handler.handle_web_request(request=request, webrtc_connection_callback=start)


@app.patch("/api/offer")
async def ice(request: SmallWebRTCPatchRequest):
    await handler.handle_patch_request(request)
    return {"status": "success"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=config.PORT)
