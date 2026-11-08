# voice/pipecat: the ears and mouth

The real-time audio front end of the voice agent (spec §19, §22.6). It hears the medic, sends what they say to the
brain (`voice/src`) and speaks whatever the brain sends back. There is no LLM here: the brain is
the LLM. The contract is the "Local API" section of [`../README.md`](../README.md).

```
transport.input() → Silero VAD → NVIDIA streaming ASR → user turns → BrainBridge → NVIDIA Magpie TTS → transport.output()
                                                                         │  POST /transcript       ▲ WS /mouth: speak
                                                                         └──────────► brain (voice/src, :8787)
```

Pipecat 1.15.0 has NVIDIA speech built in (`pipecat.services.nvidia.stt.NvidiaSTTService`,
`pipecat.services.nvidia.tts.NvidiaTTSService`; the old `riva` module names are gone), so one `nvapi-` key covers
ASR, TTS and the brain's Nemotron. The Deepgram + Cartesia fallback (spec §19) is not built: it is only needed if
Magpie turns out to sound poor, and nobody has heard it yet.

## Install

```bash
cd voice/pipecat
uv venv -p 3.12 .venv
uv pip install -p .venv -r requirements.txt
.venv/bin/python run.py --check            # builds every pipeline with a dummy key; no audio, no network
.venv/bin/python test_bridge.py            # BrainBridge against a stub brain on 127.0.0.1
```

`--transport local` also needs PortAudio, which is **not installed on this laptop**:
`brew install portaudio && uv pip install -p .venv "pipecat-ai[local]==1.15.0"`.

## Run

Put `NVIDIA_API_KEY=nvapi-…` in `voice/.env.local`, and start the brain first (`cd voice && npm start`): a WebRTC
session ends when it can't reach the brain within 1.5 s (see "No mouth, no link" below).

| Command | What |
| --- | --- |
| `.venv/bin/python run.py` | WebRTC on port 7860. On this laptop, open `http://localhost:7860/client` and press Connect. Browsers allow the mic on localhost, and their echo cancellation is on. The easiest solo test, no PortAudio needed |
| `.venv/bin/python run.py --ssl` | The same on https, for a phone on the same Wi-Fi: open the `Phone:` URL it prints (`https://<lan-ip>:7860/client`). The cert is self-signed, so the phone warns once: Chrome "Advanced → Proceed", Safari "Show Details → visit this website". Phones only allow the mic (getUserMedia) on https or localhost |
| `.venv/bin/python run.py --ssl-cert c.pem --ssl-key k.pem` | Your own cert instead (e.g. `mkcert <lan-ip> localhost`; the phone must trust mkcert's root CA). Or front plain `run.py` with `ngrok http 7860` and open the ngrok https URL; media still flows directly over the LAN |
| `.venv/bin/python run.py --transport local` | Laptop mic and speakers (PortAudio). There is no echo cancellation, so use headphones, or the agent hears itself and cuts itself off. `--no-barge-in` avoids that on laptop speakers, but then the agent talks over the medic (§15): never use it for the demo |
| `.venv/bin/python run.py --list-voices` | Ask the hosted TTS which voices it has (needs the key) |

Network: the phone must reach the laptop directly. If the venue Wi-Fi blocks device-to-device traffic, join the
laptop to the phone's hotspot, or set `ICE_SERVERS` to a TURN relay. One bodycam at a time: a new connection ends
the previous session.

**No mouth, no link (spec §23 B11).** The phone stays silent while its audio link to the worker is up, so the
worker only keeps the link up while it can actually speak. The session ends, and the phone takes over the
callouts, when any of these happen:

- the brain is unreachable for 1.5 s, at the start or after a drop;
- the brain drops this mouth on purpose: another mouth replaced it, or its TTS kept failing (`speaker.ts` closes
  with 1011 "tts failing");
- ASR or TTS fails for good (auth or invalid-request errors, e.g. a bad key).

Transient TTS errors (rate limit, network) are reported to the brain as failed playback, which leaves the row
unspoken. They end the session through the second case.

**For the bodycam page:** it can connect the same way the test client does (`@pipecat-ai/client-js` with the small
WebRTC transport, `startBotParams: { endpoint: "https://<laptop>:7860/start" }`). The routes match Pipecat's dev
runner: `POST /start` → `{sessionId}`, then `POST`/`PATCH /sessions/<id>/api/offer`. CORS is open. An https page
needs the worker on `--ssl`, and the phone must have accepted the cert once (open `https://<laptop>:7860`).

## Settings (environment first, then `voice/.env.local`)

| Setting | Default |
| --- | --- |
| `NVIDIA_API_KEY` | none (ASR and TTS refuse to connect) |
| `RIVA_VOICE` | `Magpie-Multilingual.EN-US.Aria` |
| `BRAIN_URL` | `http://127.0.0.1:8787` |
| `RIVA_ASR_FUNCTION_ID` | `bb0837de-8c7b-481f-9ec8-ef5663e9c1fa` (nemotron-asr-streaming, Pipecat's default) |
| `RIVA_TTS_FUNCTION_ID` | `877104f7-e885-42b9-8de8-f6e4c6303969` (magpie-tts-multilingual, Pipecat's default) |
| `RIVA_BOOST_WORDS` | empty. Comma list for ASR word boosting, e.g. `epinephrine,amiodarone,naloxone,i-gel,ROSC`. Untested on the hosted ASR |
| `ICE_SERVERS` | empty. A JSON list such as `[{"urls":"turn:host:3478","username":"u","credential":"p"}]`, used by both peers (the browser gets it from `/start`) |

NVIDIA changes a function id when it redeploys a model. If ASR or TTS fails with NOT_FOUND, take the current id
from the model's build.nvidia.com page (API tab). One report, unverified: Parakeet CTC 1.1B is
`1598d209-5e27-4d3c-8079-4751568b1081`.

## Voices

Magpie TTS Multilingual, EN-US: `Magpie-Multilingual.EN-US.` followed by `Aria`, `Jason`, `Leo`, `Mia`, `Ray` or
`Sofia` ([NVIDIA docs](https://docs.nvidia.com/nim/speech/latest/tts/voices.html)). Emotion variants add a suffix
such as `.Calm` or `.Neutral` (for example `Magpie-Multilingual.EN-US.Aria.Calm`). Which emotions each voice has
differs between releases, so run `--list-voices` for what the hosted endpoint actually offers.

## How BrainBridge keeps the contract

- **Hearing.** The final transcripts of one user turn are joined and posted once when the turn ends, as
  `{"text", "source": "pipecat"}`. The ASR can split a sentence at a short pause, and "Epi." then "One milligram
  IO." as two lines would give "Say again the dose." A turn that noise keeps open is flushed every 2.5 s
  (`MAX_TURN_HOLD_SECS`). Posts go in order with a 2 s timeout; a failed post is logged and dropped. Interim
  transcripts are dropped, and no transcript reaches TTS.
- **Speaking.** A `speak` becomes a `TTSSpeakFrame`, and `spoken` goes back when the bot stops speaking it. A
  `speak` that arrives while another plays, or while the medic is talking, waits in a queue (lowest priority number
  first, then oldest).
- **Turns.** `UserStarted/StoppedSpeakingFrame` → `user_speaking`. A turn ends 0.5 s after VAD hears the medic stop
  (`USER_SPEECH_TIMEOUT` in `run.py`). This uses a silence timer rather than Pipecat's smart-turn model, so a short
  "epi in" is never held back.
- **When playback doesn't finish.** Barge-in stays on (Pipecat's interruptions); the bridge sends
  `{"type":"spoken","id","interrupted":true}`, and the brain says the row once more when the medic stops. A TTS
  error before any audio, or no audio within 5 s, sends `{"type":"spoken","id","error":"…"}`, and the brain leaves
  the row unspoken. These two fields are additions to the voice/README.md contract; `speaker.ts` already handles
  both.
- **When the mouth drops.** Whatever is playing is cut (the brain re-sends it, so finishing it would say it twice)
  and the queue is cleared. An unexplained drop reconnects with backoff (0.5 s up to 5 s). A close the brain makes
  with a reason (`1000 "replaced by a new mouth"`, `1011 "tts failing"`) or with a code in 4000–4999 is final for
  the session, so the worker and the terminal bodycam don't keep replacing each other.

## Verified vs not (7 Nov 2026, no NVIDIA key on this laptop)

Verified by running:

- The install from `requirements.txt` into a fresh venv; `--check` (both NVIDIA services, Silero VAD, turn
  processor, bridge and the WebRTC transport build and link; the signaling app builds).
- `test_bridge.py` (12 checks against a stub brain): transcripts in order and kept from TTS, finals of one turn
  joined, the noisy-turn flush, the hold while the medic talks, `spoken`, the priority queue, barge-in and a stale
  stop, the no-audio watchdog, the TTS-error fast path, reconnect, audio cut when the mouth drops, no reconnect
  after the brain closes with a reason, and `on_mouth_lost` when the brain is unreachable.
- The https server and its self-signed cert (localhost, `.local` name, LAN IP).
- A real WebRTC offer/answer from an aiortc client through `/start` and `/sessions/<id>/api/offer`: the session
  starts, the transport connects, and the bridge connects to `/mouth`. Without a key, NVIDIA answers UNAUTHENTICATED,
  the session ends and the link drops. So `grpc.nvcf.nvidia.com:443` is reachable.

Not verified (needs the key, a phone, or PortAudio):

- That the default function ids are live, ASR quality on medical words, how Magpie sounds, and real latency.
- Whether Chrome's echo cancellation on the Pixel keeps the agent's own voice from triggering barge-in.
- The end-to-end failover (B11): the bodycam's on-device switch isn't built yet.
- The phone flow over https, and the prebuilt client in a real browser.
- `--transport local`, `--list-voices` output, and `RIVA_BOOST_WORDS`.

## Latency notes

The agent's reply starts after: end of speech → VAD stop (0.2 s) → turn end (0.5 s more, `USER_SPEECH_TIMEOUT`) →
the brain (a read-back has no model call; the DB round trip is in the path) → TTS first audio. The ASR final
arrives during the turn-end wait. The spec targets about 700–1200 ms voice to voice (§19), and a read-back within
about 1.2 s on the agent path (B10), so TTS first audio has to stay under roughly 0.4 s. The worker logs each
service's time to first byte (`TTFB` lines, `enable_metrics`); read them on the first real run. To trade naturalness for speed, lower `USER_SPEECH_TIMEOUT`.
NVIDIA's free tier is reportedly about 40 requests per minute per key (unverified). Each spoken utterance is one
TTS request, and ASR is one long-lived stream per session.
