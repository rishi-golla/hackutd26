# Ideation meeting — Paramedic support project (2026-10-29)

> **Historical context, not a spec.** These are AI-generated notes (Genspark) from the ideation call where the paramedic body-camera idea first came up, about a week before HackUTD 2026.
> If anything here conflicts with `Handoff Product Spec (Copy).md` (the ground truth) or `AGENTS.md`, **the spec wins**. Many questions left open here have since been decided there.
> Personal and career discussion from the call has been left out.

Participants: Justin (researcher) and the meeting lead.

---

## 1. Project direction and hackathon selection

- The team considered two ways to pick a problem: a **broad, consequential problem area** (e.g. firefighter safety) or a **narrow niche problem** (e.g. an earlier idea about chemicals inside pills). Neither was chosen at the start.
- Reference example: a friend's firefighter project that won **Hack The Valley**. It built a live spatial map of hazards inside unfamiliar buildings, covering indoor layout, firefighter locations, and chemical concentrations.
- Guiding principle: a problem that is physical in nature is better served with **hardware**, which makes the real-time impact tangible. Software alone may not fit.
- **NVIDIA track at HackUTD was a key constraint.** The NVIDIA model should be essential to the system, not decoration. The ideal bar: the project should not work as intended without **Nemotron**, if that makes technical sense. Integration details were still open.

## 2. Ideas considered before the paramedic concept

- **Radar + thermal device:** portable mmWave radar plus thermal imaging to detect people through heavy smoke. The NVIDIA role was undefined.
- **Firefighter navigation beacons:** deployable beacons, with an outside base station plotting beacon positions and walls into a live map of firefighters inside. Acknowledged, not selected.
- **Police support:** real-time help during incidents. Deprioritized because police already have radios and a lot of technology.
- **Paramedics / ambulance crews:** judged more promising and less often targeted (an impression, not market research). The opportunity is in supporting the **crew at the scene**, not in generic health hardware.
- **Time as the unifying problem:** seconds matter when a patient is near death. The 1/3/5-second figures were illustrative only. No baseline or target was set.

## 3. The concept: AI-powered paramedic body camera

- Originally proposed as a **body camera for paramedics** (by analogy to police bodycams) that:
  - connects the paramedic with **specialist doctors** at the hospital,
  - **reads vital signs automatically**,
  - offers **AI-generated triage suggestions**.
- **Why it's useful:** paramedics are trained as generalists to stabilize patients until they reach the hospital. They may lack specialist knowledge for unusual cases. The system extends that knowledge into the field; it is **not** meant to replace their training or judgment.
- Extensions discussed (concept features, not validated requirements):
  - real-time biometric readings from **sensors attached to the patient**, avoiding delays from the usual equipment setup,
  - **live video + vitals streamed to hospital staff** so they see patient status before arrival,
  - documentation of what happened in the field.
- Not decided at the time: the prototype's core function, how AI suggestions are reviewed, and how to handle unreliable readings or connectivity. No video system, protocol, or data format was chosen.
- **Research lead (unverified):** Justin found a statistic that **~40% of EMS-to-hospital handoffs are missing treatment information**. The source, study population, and definition were not checked. **Verify before using it in the pitch.**

## 4. Clinical need and validation

- The value case rests on two things: (a) the limits of generalist training in specialized cases, and (b) speed and timeliness of information.
- No specific workflow to measure, no time-saving baseline, and no outcome estimate were defined.
- Optional validation idea: visit a local clinic or hospital, get feedback and possibly a quote, **if time allows**.
- No clinician feedback had been collected as of this meeting.

## 5. Hardware feasibility

- Requirements were unclear. A **3D-printed case** was a preliminary guess, not an agreed bill of materials.
- Plan: identify required parts and compare them with what the team already owns, partly using agents to research.
- **Potential builder:** the meeting lead's friend (about 6 years of hardware experience, leads a robotics club, has won the hackathons he entered but dislikes the format). He was expected to reply by **Tuesday**, likely to advise or refer someone rather than join directly.
- **Main stated risk:** the team might lack the hardware capability. There was about one week left to assess feasibility.

## 6. Timing

- **HackUTD** was the immediate target. **Hack Princeton** was mentioned as a possible later venue. There was no commitment to either with this concept at the time.
- The idea came together in about 10 minutes, versus about 3 days of searching for an idea at CalHacks.
- Justin shared a **project requirements document** and a short description from a ChatGPT conversation. The meeting lead approved it as a starting point for pitching, not as a final spec.

---

## Decisions (as of 2026-10-29)

- **Confirmed:** keep the AI paramedic body-camera concept on the list. The appeal was real-time vitals, specialist guidance, and early hospital visibility.
- **Tentative:** keep exploring it while checking hardware feasibility.
- **Tentative:** general direction is a physical problem plus a hardware component, with meaningful NVIDIA-model integration.
- **Not decided:** final project choice, which hackathon, sensors, model, or hardware architecture.

## Action items (as of 2026-10-29)

| Owner | Item | Status |
|---|---|---|
| Meeting lead | Pitch the idea to the hardware friend; ask what he can contribute or who he'd recommend; report back | planned |
| Justin | Keep researching the idea and look for flaws | in progress |
| Justin | Identify required parts and check what the team already has (incl. using agents) | planned |
| Justin | Share the requirements doc and brief description with the meeting lead | done |

## Open questions raised in the meeting

1. Which specific EMS workflow problem is the core: specialist consultation, incomplete handoffs, vitals collection, pre-arrival hospital communication, or something else?
2. Which single function should the prototype center on?
3. Can the team build a reliable prototype with the parts, skills, and time available? What are the minimum components?
4. What role will the hardware friend play?
5. What NVIDIA/Nemotron integration would be central rather than superficial?
6. Is the 40% handoff statistic real, and what is its source and definition?
7. Would paramedics or ER staff validate the need? Can a clinic visit happen in time?
8. What safety, privacy, connectivity, reliability, and clinical-oversight constraints apply to live video, biometrics, and AI triage suggestions?

## Key numbers

- **~40%** of EMS-to-hospital handoffs reportedly missing treatment info (**unverified**).
- **1–5 seconds**: illustrative emergency-response urgency only; not a target.
- **~1 week** remained (as of Oct 29) to assess hardware feasibility.
