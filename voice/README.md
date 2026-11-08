# voice/ · Voice agent worker (spec §19)

Pipecat worker for the medic's harness. Synthetic-data prototype, not a medical device.

```
phone (hub/phone.html?voice=…)  ──WebRTC mic + camera──►  worker (server.py, port 7860)
   ▲                                                          │
   └────────────── WebRTC audio (Kokoro voice) ◄──────────────┤
                                                              ├─ audio → Silero VAD + Smart Turn → Nemotron ASR (NVIDIA cloud)
                                                              │        → Nemotron 3 Nano Omni (self-hosted vLLM, tools) → speech policy → Kokoro TTS
                                                              ├─ video → 1 frame/s → Omni vision → ID card / meds / AED pads / airway / IV-IO
                                                              └─ SpacetimeDB HTTP API: add_transcript, identify_patient, log_event,
                                                                 log_agent_step, callout_spoken; polls state once a second
```

- **Tools Nemotron can call** (`handoff_voice/tools.py`): `get_state`, `search_ehr`, `check_allergy`,
  `check_dose_range`, `log_event`, `look`. Allergy and dose results come from code (`clinical.py`), never the model.
  `search_ehr` refuses a name or birth date that wasn't heard (or read off an ID card) and never picks between matches.
  A single match calls `identify_patient`; W6 in `agent/` then pulls and saves the record and posts its callout.
- **Speech policy** (`policy.py`): replies are buffered and spoken only if ≤ 15 words (8 for unprompted), every
  number appears in the state or a tool result, no compression depth, no repeat within 30 s. Callouts from
  SpacetimeDB are spoken through the same gate: one per 4 s, priority order, never while the medic is talking.
- **Vision** (`vision.py`): one Omni call at a time, about 1 a second; findings under 0.7 confidence are dropped.
  An ID card goes through the same `search_ehr` path (method "ID card"); a drug being given becomes
  `log_event(med_<drug>, …, "seen", …)` and the deterministic allergy and dose checks run on it. Frames for each
  finding are saved under `evidence/`. Without WebRTC video it falls back to the hub's `/frame.jpg` when `HUB_URL` is set.
- Every tool call, spoken line, held-back reply and measured voice-to-voice latency is a row in `agent_step`
  (workflows "Voice" and "Vision"), so it shows in the hospital trace panel.

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env      # NVIDIA_API_KEY for Nemotron ASR; Omni/Kokoro URLs; local SpacetimeDB
.venv/bin/python server.py
```

- Omni: vLLM on a GPU serving `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-FP8` as `omni` with
  `--enable-auto-tool-choice --tool-call-parser qwen3_coder --reasoning-parser nemotron_v3`, reached at `OMNI_BASE_URL`.
- Kokoro: `kokoro_server.py` on the same GPU (`pip install kokoro soundfile fastapi uvicorn`,
  `uvicorn kokoro_server:app --port 8880`), reached at `KOKORO_BASE_URL`. It streams 24 kHz PCM from
  `/v1/audio/speech`.
- Use `handoff-local` for development. The worker warns if pointed at Maincloud.
- Phone: open `hub/phone.html?voice=https://<worker>`. The phone page is https, so the worker needs an https URL
  too (a tunnel). `http://localhost:7860/` is a bare test page.
- `test_client.py` runs a full session over real WebRTC without a phone: WAV files as the mic, an image as the
  camera, and prints the time from the end of each utterance to the first reply audio.

## Measured (Sat night, synthetic speech, worker on a Devin VM, Omni + Kokoro on a Brev H100)

| Step | Time |
| --- | --- |
| Omni turn, text in → tool call | ~220–350 ms per LLM round (a tool call costs 2 rounds) |
| Kokoro first audio (through the tunnel) | ~160 ms (curl), ~320 ms TTFB in Pipecat |
| Omni vision frame (ID card) | ~320–620 ms |
| End of medic speech → first reply audio | **1.6–2.9 s**, 3.4 s when the reply waits on W6's record callout |

The spec target (700–1200 ms) is not met yet. Most of the gap is waiting for the final ASR transcript
(Riva endpointing, `ASR_STOP_HISTORY_MS`) and tool calls needing a second LLM round.
