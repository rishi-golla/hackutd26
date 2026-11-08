# Handoff SpacetimeDB module

This is the shared live record for every device: the relay, the bodycam, the monitor, the hospital dashboard and
the agent. It's owned by the **hospital lane** (Josh). **Ask before changing anything here**, and run
`npm run generate` in `web/` after every schema change.

| | |
| --- | --- |
| Database | `handoff-hackutd26` on Maincloud: **published** 2026-11-07 17:26; dashboard https://spacetimedb.com/handoff-hackutd26 |
| HTTP base | `https://maincloud.spacetimedb.com` |
| WebSocket (TS SDK) | `wss://maincloud.spacetimedb.com` |
| Local dev | `spacetime start`, then publish as `handoff-local` to `http://127.0.0.1:3000` |

Source files: tables in `src/schema.ts`, reducers in `src/index.ts`, callout rules in `src/rules.ts`, shared
helpers in `src/helpers.ts`.

## Setup (one time)

```bash
curl -sSf https://install.spacetimedb.com | sh        # installs ~/.local/bin/spacetime
export PATH="$HOME/.local/bin:$PATH"
cd spacetime && npm install
cd ../web && npm install
```

## Publish (hospital lane only)

```bash
cd spacetime
spacetime login                                        # once, opens a browser
spacetime publish handoff-hackutd26 --module-path . --yes
# breaking schema change during the hackathon: add --delete-data=always (wipes all rows)
cd ../web && npm run generate                          # regenerate TS bindings, then commit them
```

Local server instead of Maincloud:

```bash
spacetime start                                        # separate terminal
spacetime publish handoff-local --server local --module-path . --yes
# web/.env.development.local:
#   VITE_SPACETIMEDB_HOST=ws://127.0.0.1:3000
#   VITE_SPACETIMEDB_DB_NAME=handoff-local
```

## Relay (HTTP, no SDK)

On the Pi these calls are made by `bridge/hub_bridge.py`, which forwards the sensor readings from kgand's hub
(`hub/hub.py`); see `bridge/README.md`. The examples below are the same calls, for testing by hand.

Every call is `POST /v1/database/<db>/call/<reducer>`, with the arguments as a JSON array. Relay reducers take
`[device, json]`, where `json` is a JSON **string**.

```bash
B=https://maincloud.spacetimedb.com; DB=handoff-hackutd26
TOKEN=$(curl -s -X POST $B/v1/identity | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

# vitals, about once a second. null (or leaving the key out) = no reading.
# hr/spo2 are dropped unless status is "pulse". "simulated" is REQUIRED (true for --simulate).
curl -X POST $B/v1/database/$DB/call/push_vitals "${H[@]}" \
  -d '["relay-1", "{\"hr\":72,\"spo2\":97.5,\"temp_c\":36.4,\"status\":\"pulse\",\"simulated\":false}"]'

# waveform batch, about every 200 ms (raw ir values; up to 200 per batch)
curl -X POST $B/v1/database/$DB/call/push_waveform "${H[@]}" \
  -d '["relay-1", "{\"samples\":[109876,109901,110012],\"rate_hz\":25,\"simulated\":false}"]'

# MARK (short press)
curl -X POST $B/v1/database/$DB/call/mark "${H[@]}" -d '["relay-1", "{}"]'

# 2 s hold: starts an incident if none is active, otherwise closes it
curl -X POST $B/v1/database/$DB/call/toggle_incident "${H[@]}" -d '["relay-1"]'
```

`spo2` is also accepted as `spo2_exp`, so the relay's existing message field works as-is. A bad JSON string, or
one without `"simulated"`, returns an error status (530 on the local 2.14.1 server) with the error text. Keep
the token: one identity per device is fine.

## Browser clients (TS SDK)

```tsx
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '../../module_bindings';

const { getConnection } = useSpacetimeDB();
const [callouts] = useTable(tables.callout);           // live rows
getConnection()?.reducers.pushCpr({ rate: 104, count: 30, sinceLastS: 0.5, paused: false, compressing: true });
```

The connection is built once in `web/src/db/connection.ts`. Pages only use the hooks. Rows use camelCase
(`incidentId`), `u64` values are `bigint`, and option values are `T | undefined`.

## Reducers: who calls what

| Caller | Reducer (args) | Notes |
| --- | --- | --- |
| Relay | `push_vitals(device, json)` | see above |
| Relay | `push_waveform(device, json)` | see above |
| Relay / bodycam | `mark(device, json)` | json `{}` or `{"note":"…","source":"voice"}`; relay default source `MARK` |
| Relay | `toggle_incident(device)` | hold button |
| Any | `start_incident(unit)` | no-op if an incident is already active; status `on_scene`, DEMO TIMING on |
| Any | `set_status(status, sourceKind, sourceDetail)` | `on_scene` `arrest` `rosc` `en_route` `arrived` `closed`; the source is the timeline chip, e.g. `("arrest", "voice", "her heart stopped")`. Any transition is allowed (demo controls need it) |
| Any | `heartbeat(device, kind)` | keeps the `device` row's `lastSeen` fresh |
| Bodycam | `pushCpr({rate?, count, sinceLastS, paused, compressing})` | phone detector output, about 2×/s. Before the first compression, send `sinceLastS` = seconds since the page started; the server caps pauses at the time since the arrest began. `count` may reset on page reload |
| Bodycam | `addTranscript({text})` | one row per sentence |
| Bodycam | `identifyPatient({patientRef, method})` | method `ID card` / `voice` / `manual` |
| Bodycam | `logEvent({kind, label, sourceKind, sourceDetail})` | read-backs etc. See event kinds below |
| Bodycam | `setEventStatus({eventId, status})` | `cancelled` on "Correction", `confirmed`, `flagged` |
| Bodycam | `calloutSpoken({calloutId})` | after speaking a callout |
| Bodycam (W6) | `savePatientRecord({...})`, `addCallout({text, priority})`, `logAgentStep({workflow, tool, summary})` | |
| Bodycam / hospital | `sendRtcSignal({sessionId, sender, kind, payload})` | WebRTC handshake, below |
| Monitor | `monitorTap({button})` | `EPI` `AMIO` `SHOCK` `AIRWAY` `ROSC` `MARK`. A tap carries no dose: it logs "Epinephrine (tap)" and the read-back adds the dose when they merge |
| Monitor | `demoControl({action, arg})` | `start` `arrest` `rosc` `en_route` `arrived` `close` `reset` `cpr_slow` `cpr_good` `cpr_clear` `epi_due_now` `identify` (arg = patient id) `demo_timing` (arg `on`/`off`) |
| Any (caller not decided) | `synthesizeSeizure({active})` / HTTP `synthesize_seizure` `[true]` or `[false]` | Overrides the relay's sensor data with a hardcoded seizure. See "Synthetic seizure" below |
| Hospital | `requestReport()` | the Generate Handoff button; works on the newest incident even after close |
| Agent | `setDestination({hospitalId, etaMin})`, `erMessageOut({text})`, `saveReport({incidentId, contentJson})`, `logAgentStep(...)` | |

Most reducers act on the **active incident**: the newest one whose status isn't `closed`. Rows written when
no incident is active get `incidentId = 0`. `identify_patient`, `log_event`, `monitor_tap`, `set_status` and
`set_destination` **throw when no incident is active**, so catch the rejected promise. `save_report` closes
the incident (spec §9), and after that its events are read-only.

**W6 trigger (bodycam lane):** pull the record whenever `incident.patientRef` changes, not only after your own
`identifyPatient` call. The monitor's demo control `identify` also sets it.

## Tables (all public except rule bookkeeping)

Differences from spec §22 (deliberate):
- `incident.eta_min` is `etaAt`, the arrival time. Remaining minutes = `etaAt - now`.
- `event.sources_json` is a typed `sources` array of `{kind, detail, ts}`, plus a `status` column.
- `patient_record` lists are `string[]`, with a `source` column (`EHR` or `cached`).
- `rtc_signal` is keyed by `sessionId`, not by incident.
- `cpr_state.countBase`: compressions this arrest = `count - countBase`.
- There are no `frame` or `snapshot` tables (no snapshot video, AGENTS.md section 0).
- Reducers: `agent_step` is `log_agent_step`. `timer_fire` is part of `tick_rules`. `push_frame`,
  `save_snapshot` and `er_message_in` don't exist. Added: `toggle_incident`, `heartbeat`, `set_event_status`,
  `request_report`, `synthesize_seizure` (and its `vitals_override` table).

`incident`, `device`, `vitals` (kept 30 min), `waveform` (kept 30 s), `cpr_state` (one row per incident),
`transcript`, `rtc_signal` (kept 10 min), `event`, `timer`, `callout`, `er_message`, `agent_step`, `hospital`
(3 fictional, seeded), `patient_record`, `report`, `vitals_override` (a row means a synthetic scenario is on). Private: `rule_state`, `tick_schedule`. Note that the SQL
column for SpO₂ is `spo_2`; in TS it's `spo2`.

## Event kinds and merging

`kind` decides merging: a second report of the same kind within 60 s (20 s with DEMO TIMING on) is added to the
same event as another source. That's how voice plus label becomes one epi event with two chips.

- medications: `med_<generic name>`, e.g. `med_epinephrine`, `med_amiodarone`, `med_naloxone`. A new
  `med_epinephrine` event starts the epi timer.
- `shock`, `airway`, `mark`, `finding`, `procedure`, `patient_identified`, `destination`, `status_<status>`
- written by the rules: `cpr_coached`, `cpr_paused`, `vitals_alarm_hr`, `vitals_alarm_spo2` (a merged alarm shows
  the newest number); by scenarios: `simulation_<name>`, `simulation_end_<name>`; CPR start: `cpr_started`
- `sourceKind` is the chip: `voice`, `read-back`, `label`, `tap`, `MARK`, `motion`, `callout`, `EHR`, `ID card`,
  `agent`, `relay`, `demo`. `sourceDetail` is the evidence text, such as the transcript line.

## Synthetic seizure (`synthesize_seizure`)

Makes the patient look like they're deteriorating, even though the teammate on the mat is healthy.

- `synthesize_seizure(true)` starts it. `tick_rules` writes one vitals row and one waveform batch per second from
  the hardcoded scenario in `src/scenarios.ts`: HR climbs from 96 to about 170 and SpO₂ falls from 97 to 80
  over 30 s, then the last row holds. Temperature is replaced too (36.9 → 37.5 °C). Rows use device
  `sim-seizure` and `simulated = true`.
- While it's on, the real relay's vitals and waveform calls still succeed (and keep the relay's `device` row
  fresh), but they aren't stored, so nothing flickers between real and synthetic numbers.
- `synthesize_seizure(false)` stops it, and the relay's real data flows again. Closing the incident (any way)
  and `demo_control reset` also stop it.
- **Relay lane:** `push_vitals` still returns success while it's on, so the relay LCD keeps showing the real
  pulse while the other screens show the seizure. To show it on the LCD, poll `SELECT * FROM vitals_override`
  (a row means on).
- **Not in an arrest:** vitals alarms are off during an arrest (spec §9). The demo controls' Arrest replaces the
  seizure with the `arrest` scenario (no pulse); see below.
- **Known gap:** the synthetic waveform is one fixed trace (too fast for the HR, one batch per second). Nothing
  draws a waveform yet; fix it when H3's waveform is built.
  Calling `true` while it's already on does nothing (the scenario doesn't restart).
- Start and stop add timeline events (`simulation_seizure` / `simulation_end_seizure`, source `demo`). The normal vitals alarms
  apply (not during an arrest): about 20 s in, "Heart rate one sixty-…", then "Oxygen saturation eighty-…".
- Change the numbers in `src/scenarios.ts` and republish. Where it's called from (`/controls`, the agent, a
  hotkey) is not decided yet.

### Arrest and ROSC scenarios (Alan, Sun ~02:00)

The same override, started by the demo controls instead of `synthesize_seizure`:

- `demo_control('arrest')` sets the status and starts the `arrest` scenario: HR 0, no SpO₂, status `no pulse`,
  temperature 36.6 °C, a flat waveform; device `sim-arrest`. Held until ROSC, close or reset.
- `demo_control('rosc')` sets the status and switches to `rosc`: HR 38 → ~104 and SpO₂ (from the 4th second)
  84 → ~93 over ~10 s, then held; a calm ~100/min waveform; device `sim-rosc`. En route and arrived keep it.
- A scenario's hr/spo2 are stored as written, so the arrest's HR 0 is in the row even though the status isn't
  `pulse`. Readers that only trust `pulse` rows (the §15 alarms, the agents' "valid" flag) treat it as no valid
  pulse, which is right.
- `synthesize_seizure(true)` replaces either one; `synthesize_seizure(false)` only stops the seizure. Close and
  reset stop any scenario. Arrest set any other way (`set_status`, the voice agent) doesn't start one, but leaving
  the arrest any way ends its scenario (ROSC switches to `rosc`).
- Timeline kinds are per scenario: `simulation_<name>` and `simulation_end_<name>`.

### CPR start (Alan, Sun ~02:15)

- `demo_control('normal')` starts the `normal` scenario (Sun ~06:15): realistic HR 72–84 and SpO₂ 97–99 that loop, device
  `sim-normal`, `simulated = true`, for a patient teammate whose finger clip is off or unreliable. `demo_control('sim_off')`
  stops whatever scenario is on. Arrest, ROSC and the seizure replace it like any other scenario.

Arrest doesn't start CPR. CPR starts with `demo_control('cpr_start')` (also `cpr_slow` / `cpr_good` during an
arrest), or `log_event('cpr_started', …)` from the voice agent when the medic says it. That sets the arrest if
needed, starts the cycle timer, resets the CPR stats and logs "CPR started" once; again is a no-op. The CPR
callouts (push faster, slow down, resume compressions) only run after it.

## Callouts

`tick_rules` runs every second and queues callouts (spec §15). The bodycam subscribes to `callout`, speaks rows
where `spokenAt` is empty (lowest `priority` number first), then calls `calloutSpoken`. Unspoken callouts older
than 20 s are deleted so stale words are never spoken.

## WebRTC signaling (live video only, never snapshots)

`rtc_signal {sessionId, sender: "bodycam"|"hospital", kind: "offer"|"answer"|"ice"|"request", payload}`.
`payload` is `JSON.stringify(description)` or `JSON.stringify(candidate)` (empty for `request`).
1. The bodycam makes a new `sessionId` on each tap-to-start and sends `offer`, then its `ice` rows.
2. The hospital answers the newest bodycam offer with `answer`, then sends its `ice` rows for that session.
3. When the hospital page loads (or the video goes stale), it sends `request` with `sessionId` `""`. The bodycam
   replies with a fresh `offer`, which is how a reloaded dashboard gets video back.
4. Each side ignores rows from itself and from other sessions.

HTTPS for the phone: `cd web && npm run dev:https` (self-signed; tap Advanced → Proceed once). That mode uses
`web/.env` (Maincloud), not `.env.development.local`.
