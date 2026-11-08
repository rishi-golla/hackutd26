"""Voice agent worker: FastAPI signaling for Pipecat's SmallWebRTC transport (no rtc_signal rows)."""
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from fastapi import BackgroundTasks, FastAPI, Request, Response
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
ICE = [{"urls": "stun:stun.l.google.com:19302"}]
if config.TURN_URL:
    ICE.append({"urls": config.TURN_URL, "username": config.TURN_USER, "credential": config.TURN_PASS})
handler = SmallWebRTCRequestHandler(ice_servers=[IceServer(**s) for s in ICE])


@asynccontextmanager
async def lifespan(_app: FastAPI):
    state.start()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/")
async def index():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.get("/api/ice")
async def ice_servers():
    return ICE


@app.post("/api/offer")
async def offer(request: SmallWebRTCRequest, background_tasks: BackgroundTasks):
    async def start(connection: SmallWebRTCConnection):
        background_tasks.add_task(run_bot, connection, stdb, state, ehr)

    return await handler.handle_web_request(request=request, webrtc_connection_callback=start)


@app.patch("/api/offer")
async def ice(request: SmallWebRTCPatchRequest):
    await handler.handle_patch_request(request)
    return {"status": "success"}


@app.get("/phone.html")
async def phone():
    """The hub's phone page, same origin as the worker, so one tunnel/preview URL carries both."""
    return FileResponse(Path(__file__).parent.parent / "hub" / "phone.html", headers={"Cache-Control": "no-store"})


if config.HUB_URL:
    hub = httpx.AsyncClient(base_url=config.HUB_URL, timeout=20)

    @app.api_route("/{path:path}", methods=["GET", "POST"])
    async def hub_proxy(path: str, request: Request):
        """Everything else the phone page calls (/common.js, /poll, /send, /frame, /audio) goes to the hub."""
        r = await hub.request(request.method, "/" + path, params=request.query_params, content=await request.body(),
                              headers={k: v for k, v in request.headers.items() if k.lower() == "content-type"})
        return Response(r.content, r.status_code, media_type=r.headers.get("content-type"),
                        headers={"Cache-Control": "no-store"})


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=config.PORT)
