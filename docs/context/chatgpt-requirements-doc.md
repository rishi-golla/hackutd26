# Handoff — original requirements doc (from ChatGPT, ~2026-10-29)

> **Historical context, not a spec.** This is the first project requirements doc, written in a ChatGPT conversation during ideation and shared at the 2026-10-29 meeting.
> If anything here conflicts with `SPEC.md` (the ground truth), **the spec wins**. The current brief has changed scope since this was written, including the chest-worn phone, the relay box beside the patient, and CPR coaching.

**NVIDIA × Emergency Medical Services × Real-Time AI**

## Project vision

Handoff is a real-time AI command center that connects paramedics in the field with emergency departments before the patient arrives.

A paramedic responding to a 911 call turns on their phone or body camera. The receiving hospital immediately gets a live view of the scene, the patient's condition, and the care being given.

As the paramedic works, Handoff combines live video, audio, patient biometrics, and AI into a continuously updated picture of the emergency. The ED doesn't have to wait for a radio report or a verbal handoff at arrival. It already knows what's happening and can prepare.

## North Star

**A live, AI-powered operating system for prehospital emergency care.**

It is a web platform where paramedics can:

- livestream an emergency,
- connect patient vital-sign sensors,
- document assessments and treatments,
- share a real-time, AI-generated patient record with a receiving hospital.

The whole incident is visible through a single unified dashboard.

## Core product requirements

### 1. Live paramedic POV streaming
Stream video and audio from the paramedic's smartphone or wearable camera to the hospital dashboard. Authorized hospital staff can watch in real time.

### 2. Live patient biometrics
Stream and visualize vital signs: heart rate, SpO₂, blood pressure, respiratory rate, and possibly ECG.
For the demo, use either a real pulse sensor or simulated medical-monitor data. Show continuously updating measurements and trends.

### 3. AI scene understanding and triage assistance
AI analyzes the live audio, video, and vitals to extract relevant observations, flag important changes, and organize triage information.
The dashboard shows an AI-generated situation summary next to a **paramedic-confirmed** triage status.
**For the demo, triage suggestions use scripted scenarios. The AI makes no autonomous clinical decisions.**

### 4. Automatically generated incident timeline
Live transcription and event extraction build a chronological record of:

- patient assessments and symptoms,
- changes in vital signs,
- treatments and medications reported by paramedics,
- significant observations and events.

Every event has a timestamp. **AI-inferred details must be visually distinct from confirmed information.**

### 5. Live emergency department dashboard
One interface shows the incoming patient:

- live camera feed,
- current biometrics and trends,
- patient information and triage status,
- AI situation summary,
- event timeline,
- ambulance location and ETA.

### 6. Automatic patient handoff report
At any point, the system can generate a structured handoff covering:

- patient presentation,
- vital signs,
- reported interventions,
- relevant changes,
- current condition.

**The paramedic reviews and confirms the report before it counts as final.**

## The 24-hour demo story

1. **Dispatch.** The paramedic receives a simulated emergency call and starts a Handoff session on their phone.
2. **Arrival on scene.** The paramedic starts livestreaming a training mannequin. The hospital dashboard immediately shows the live feed and incident details.
3. **Patient assessment.** The paramedic describes symptoms aloud. The AI transcribes the speech, extracts observations, and fills in the patient summary.
4. **Biometric monitoring.** Live or simulated vitals stream into the dashboard. One reading changes significantly, and the UI highlights a new observation.
5. **Treatment.** The paramedic announces a simulated intervention. Handoff records it as a **proposed** timeline event, and the paramedic confirms it.
6. **Hospital preparation.** The hospital sees the live incident, the confirmed triage status, the evolving patient record, and the ambulance ETA.
7. **Handoff completed.** The paramedic taps **Generate Handoff**. A structured report appears with the full case summary and key timestamps.

## Hardware

Almost all of this can be built with equipment the team already owns.

| Item | Role |
|---|---|
| Smartphone (paramedic) | Captures video, audio, and location. A chest mount is optional; the phone can be held. |
| MacBook | Runs the app and backend, orchestrates streaming, processes sensor data, handles AI requests. No Jetson needed. |
| *Optional:* ESP32 + MAX30102 | Real pulse-sensor readings streamed to the dashboard, as a tangible hardware integration. Otherwise, simulate all biometrics. |
| Training mannequin | Makes the scenario realistic and gives a safe subject for the livestream. |
| Second laptop / monitor | Serves as the hospital display. |

## Technical stack (suggested)

| Component | Suggested implementation |
|---|---|
| Web application | Next.js + React |
| Video / audio streaming | WebRTC |
| Speech transcription | Streaming speech-to-text |
| AI understanding | Multimodal LLM on sampled video frames + transcript |
| NVIDIA integration | NVIDIA-hosted inference or NIM-compatible endpoint, subject to access |
| Sensor streaming | ESP32 → WebSocket → backend |
| Dashboard updates | WebSockets / real-time database |
| Maps / ETA | Mapbox or Google Maps |
| Data storage | Supabase or PostgreSQL |

**NVIDIA angle:** use NVIDIA inference services for speech, vision, or multimodal analysis. No NVIDIA GPU needs to be physically present. The MacBook handles the app and streaming, and NVIDIA provides inference remotely. **Confirm the available NVIDIA services and sponsor credits before locking this in.**

## Scope for 24 hours

### Must build
- [ ] Phone-to-browser livestream
- [ ] Live patient dashboard
- [ ] Real-time biometric stream (mocked or sensor)
- [ ] AI transcription and event extraction
- [ ] AI-generated patient summary and timeline
- [ ] Clinician-confirmed triage status
- [ ] Generate handoff report

### Nice to have
*(The original showed 1 of 5 checked, but not which one.)*
- [ ] Real ESP32 pulse-sensor integration
- [ ] Live map and ambulance ETA
- [ ] NVIDIA-hosted multimodal inference
- [ ] AI analysis of camera frames
- [ ] Two-way hospital/paramedic communication

### Skip for now
- Custom bodycam or wearable enclosure
- NVIDIA Jetson edge device
- Medical-grade patient monitors
- EHR integrations
- Automatic clinical diagnosis or treatment decisions

## Essential result

**One phone streaming an emergency to one hospital dashboard, with live vitals, AI-generated situational awareness, and an automatically compiled handoff.** Everything else is optional for the 24-hour build.
