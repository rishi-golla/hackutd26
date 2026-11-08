# Mock FHIR R4 EHR (synthetic)

A small read-only FHIR R4 server with five **synthetic** patients (spec §17, X2). It has no dependencies:
Node 22.18+ runs the TypeScript directly. Owned by the hospital lane. W6 (bodycam lane) queries it.

```bash
cd ehr
npm start                     # http://localhost:4100/fhir   (PORT=… to change)
```

It listens on all interfaces, so other devices on the same network can use `http://<laptop-ip>:4100/fhir`.
Responses are `application/fhir+json`, with CORS open and well under 1 ms locally (X2 asks for under 300 ms).

## Queries

| Query | Returns |
| --- | --- |
| `GET /fhir/Patient?name=jordan avery&birthdate=1968-03-14` | Bundle: the match(es). `name` matches word starts in the given or family name |
| `GET /fhir/Patient?name=Jordan Avery` | **Two** matches (pt-0001 and pt-0002): use this to show "ask, never guess" (X8) |
| `GET /fhir/Patient/pt-0001` | One Patient |
| `GET /fhir/AllergyIntolerance?patient=pt-0001` | Bundle (`patient=Patient/pt-0001` also works) |
| `GET /fhir/MedicationStatement?patient=pt-0001` | Bundle (also `subject=`) |
| `GET /fhir/Condition?patient=pt-0001` | Bundle |
| `GET /fhir/Patient/pt-0001/$everything` | Bundle: the patient plus all of the above |
| `GET /fhir/metadata` | CapabilityStatement |

Other search parameters: `_id`, `given`, `family`, `gender`, `identifier`. Unknown parameters are ignored, as FHIR
allows. Writes return 405.

**Code status** is a Patient extension: `{"url": "urn:handoff:code-status", "valueString": "Full code"}`.

## The patients (all synthetic)

| ID | Name | Born | Allergies | Medications | Conditions |
| --- | --- | --- | --- | --- | --- |
| pt-0001 | Jordan Avery (demo patient) | 1968-03-14 | **amiodarone** | warfarin, metoprolol | coronary artery disease, MI (2021) |
| pt-0002 | Jordan Avery | 1991-07-22 | penicillin | albuterol inhaler | asthma |
| pt-0003 | Maria Delgado | 1955-11-02 | sulfonamide antibiotics | metformin, lisinopril | type 2 diabetes, hypertension |
| pt-0004 | Samuel Okafor | 1979-05-09 | none | levetiracetam | epilepsy |
| pt-0005 | Priya Raman | 1986-01-30 | none | levothyroxine | hypothyroidism |

All are full code. Edit `src/data.ts` to change them.

**Cached copy (X7, W6's job):** if this server doesn't answer, W6 uses a saved copy of the record and labels it
`cached`. `GET /fhir/Patient/pt-0001/$everything` gives the exact bundle to save.

**Phones and HTTPS:** a bodycam page served over HTTPS can't call this plain-HTTP server from the browser (mixed
content). Call it from a laptop process (the agent or worker) instead, or put it behind HTTPS.
