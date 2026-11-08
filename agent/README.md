# Handoff workflow agent (W1, W4, W6)

A Node process on the laptop. It subscribes to SpacetimeDB and runs three workflows from spec §19. W1 and W4 are
the hospital lane's. W6 is the bodycam lane's (spec §0.1 decision 2); it runs here because this process already has
the Nemotron tool loop and the trace, and an HTTPS page can't call the plain-HTTP EHR (mixed content).

| Workflow | Trigger | What it does |
| --- | --- | --- |
| **W1** destination + pre-arrival alert | incident status becomes `arrest` or `en_route` with no destination yet | Chooses a hospital (cardiac arrest → nearest with a cath lab and free beds), calls `set_destination`, posts the alert with `er_message_out` (E1: unit, patient name and age, problem, treatments, allergies, ETA) |
| **W6** patient record (EHR pull) | `incident.patientRef` set ("Identify patient", or any `identify_patient`) with no record for that patient yet; or a transcript line that may hold a name and birth date ("patient is…", "born…", a date) | Transcript: Nemotron decides → `ehr_search` (name + birth date) → `pull_record` (one match only) or `ask_crew`. Then `identify_patient` → `ehr_get_record` → `save_patient_record` (source `EHR` or `cached`) → `add_callout` "Record found. Jordan Avery, 58. Allergy: amiodarone. On warfarin." |
| **W4** handoff report | a `report` row with status `requested` (the Generate Handoff button), or status `arrived` with no report | Gathers facts from the tables → Nemotron drafts MIST lines that cite fact ids → self-check → posts "Handoff report ready…" (E4) → `save_report` (closes the incident) |

Every step goes to the trace (`log_agent_step`), which the hospital dashboard shows.

## Run

```bash
cd agent
npm install
cp .env.example .env.local      # put NVIDIA_API_KEY=nvapi-… in it (gitignored, never commit it)
npm start
```

**Only one copy may run per database, and for the shared Maincloud database that's Josh's** (SPEC.md §0.1
decision 17).
- **No lock:** every copy watches the same database, and nothing stops a second copy.
- **A second copy duplicates everything:** two alerts, two destination calls, double trace steps, two reports
  (the last one wins), and double NVIDIA usage.
- **No key doesn't help:** without `NVIDIA_API_KEY` the agent still acts, using the rule and template fallback.
- **To test it yourself,** point it at a local database instead:
  `SPACETIMEDB_HOST=ws://127.0.0.1:3000 SPACETIMEDB_DB_NAME=<your local db> npm start`.

Settings (environment or `.env.local`):

| Setting | Default |
| --- | --- |
| `NVIDIA_API_KEY` | none. Without it the agent runs the template fallback only |
| `NEMOTRON_MODEL` | `nvidia/nemotron-3-ultra-550b-a55b` (the exact slug is still [OPEN] in spec §28) |
| `NEMOTRON_THINKING` | `off` (sends `chat_template_kwargs.enable_thinking=false`; measured 10.6 s vs 14.3 s for a report-sized call) |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` (OpenAI-compatible) |
| `EHR_BASE_URL`, `EHR_TIMEOUT_MS` | `http://localhost:4100/fhir`, `1500` (after that W6 uses the cached copy) |
| `SPACETIMEDB_HOST`, `SPACETIMEDB_DB_NAME` | `wss://maincloud.spacetimedb.com`, `handoff-hackutd26` |
| `DISPLAY_TZ` | `America/Chicago` (times in alerts and reports) |

Regenerate the bindings after a schema change: `npm run generate`.

Regenerate the cached EHR copy after changing `ehr/src/data.ts` (with the EHR running):

```bash
python3 -c 'import json,urllib.request as u; d=json.load(open("src/ehr-cache.json")); d["patients"]={f"pt-000{i}":[e["resource"] for e in json.load(u.urlopen(f"http://localhost:4100/fhir/Patient/pt-000{i}/$everything"))["entry"]] for i in range(1,6)}; json.dump(d,open("src/ehr-cache.json","w"),indent=1)'
```

## How it stays honest (spec §19 agent rules)

- **Facts only:**
  - W1: the model sees only what the tools return. An alert containing a number that isn't in those results is
    rejected, and the model must rewrite it.
  - W4: the model sees only numbered facts read from the tables (`src/facts.ts`).
- **W1 checks:**
  - During an arrest, a hospital without a cath lab is refused.
  - An alert posted before the destination is refused.
  - A record from the cached copy is labelled as cached (X7).
  - Flagged drugs (an allergy warning, a drug seen but not said) are never listed as given.
- **W6 checks (X3–X8):**
  - It searches only with a name and a birth date (X8). The model's search is refused unless the name's words
    and the birth year are in what the medic said.
  - `pull_record` is refused unless it's the single match of the last search; with several or none it asks the
    crew ("Several records match. Confirm name and birth date." / "No record found. Check name and birth date." /
    "Need the patient's birth date."), at most once every 20 s per incident.
  - The record is mapped from FHIR by code (`src/ehr.ts`); the model never writes record fields. It only drafts
    the spoken summary, which is rejected unless it starts "Record found", says the recorded name, mentions every
    allergy (or "No allergies recorded"), has at most 12 words after the name, and passes the number and claim
    checks. Otherwise the template speaks.
  - If the EHR doesn't answer within `EHR_TIMEOUT_MS`, search and record come from `src/ehr-cache.json`, the
    record is saved with source `cached` and the callout ends "Cached record." (X7).
  - **Fast path (X3):** when the fixed parser (`parseIdentity`) already hears a full name and a birth date, W6
    searches at once with no model call (record on screen in about 0.5 s locally). Nemotron decides only for
    phrasing the parser can't read; without a key, or if the model fails, the parser applies the same policy.
    W6's model budget is 8 s; the summary call gets 6 s.
  - **Names:** the parser needs at least two words and refuses state words ("patient is breathing", "not
    responding", "a 58 year old"), so it never asks for a birth date after a non-name. A bare number ("2000 units")
    doesn't trigger W6; a date or "born" does.
  - Vision (an ID card in the camera) isn't wired yet: when it exists, it can call `identify_patient` or add the
    words to the transcript and W6 picks it up.
- **Self-check (W4):** a drafted line is dropped if it:
  - has no sources,
  - cites an id that isn't a fact,
  - contains a number its cited facts don't contain (whole numbers, so "96" isn't "found" inside 1968),
  - makes a claim its cited facts don't support: sex, transport or en route, shocks, airway or intubation, or
    witnessed (`RISKY_CLAIMS` in `src/llm.ts`; the real model added "male" and "en route" in testing), or
  - mentions compression depth.
  The W1 alert gets the same number and claim checks against the tool results.

  Labels the cited facts carry are added back if the model dropped them: "(simulated)", and "(experimental)" for
  SpO₂. The report says how many lines were dropped.
- **Flagged items** go under "!" as "not confirmed as given", never under Treatment.
- **One W4 per incident at a time:** a second Generate Handoff during a run is covered by that run, and the
  dashboard button is disabled while a report is requested or ready.
- **Always finishes:**
  - With no key, a model error, or the deadline reached (W1 at 14 s, W4 at 27 s), the rule and the template fill
    in whatever is missing.
  - The alert still appears within 20 s (E1) and the report within 30 s (H7).
  - Within each section, any template line whose facts the model didn't cite there is added. Nothing the tables
    know goes missing: the CPR numbers (D4), the EHR history (X6), the allergy, and every treatment.

## Report format (`report.contentJson`)

```json
{
  "version": 1, "generatedAt": "…", "generator": "nemotron" | "template", "model": "…" | null,
  "header": { "unit": "Medic 12", "destination": "Avon Heart Institute", "time": "14:15" },
  "sections": [ { "key": "M", "title": "Mechanism · patient", "lines": [ { "text": "…", "sources": ["ehr", "ev:12"] } ] },
                "… I, S, T, ! …" ],
  "sources": { "ev:12": { "chips": ["voice", "label"], "time": "14:04", "text": "14:04 Epinephrine 1 mg IO (…)" } },
  "dropped": 0
}
```

Source ids:

| Id | Source |
| --- | --- |
| `incident` | the incident |
| `ehr` | the patient record |
| `ev:<id>` | a timeline event |
| `cpr` | the CPR stats |
| `vitals:<id>` | the latest valid vitals |
| `tx:<id>` | a transcript line |
| `er:<id>` | an alert |

The dashboard renders the report from this format (`web/src/routes/hospital/ReportView.tsx`).

## Tested

These were tested against a local SpacetimeDB:
- the rule and template path, with no key
- the Nemotron path, using a scripted OpenAI-compatible mock

The mock checked:
- **W1:** an alert with invented numbers ("HR 140", or "SpO2 96" where 96 only appears in a birth date) is
  rejected and rewritten; Avon General is refused for an arrest; an alert before the destination is refused.
- **W4:** lines with an unknown source, no source, a made-up number or a depth claim are dropped; "(simulated)"
  is added back; the allergy and history survive; a double request runs once.

- **W6:** name then birth date on the next line → asks for the birth date, then pulls pt-0001; "Identify patient"
  → pulls without searching; an unknown birth date → "No record found"; a model search with a birth date nobody
  said is refused and the rule asks for it; "patient is breathing" → no search; a summary with "male" or a
  missing allergy is rejected for the template; with the EHR stopped, the record is saved as `cached`.

On a local database with no key, the alert lands in about 0.7 s, and W6's record fetch from the local EHR takes a
few milliseconds (shown in its `ehr_get_record` trace step). The real Nemotron endpoint is untested until a
key is added.
