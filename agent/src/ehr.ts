// Mock FHIR R4 EHR client for W6 (spec §17, X2, X7). If the EHR doesn't answer, the cached copy of the synthetic
// records (ehr-cache.json) is used and everything from it is labelled "cached".
import { readFileSync } from 'node:fs';
import { CONFIG } from './config';

type Resource = { resourceType: string; id: string; [key: string]: unknown };
type Bundle = { entry?: { resource: Resource }[] };
export type Source = 'EHR' | 'cached';
export type PatientMatch = { id: string; name: string; birthDate: string };
export type EhrRecord = {
  patientRef: string;
  name: string;
  birthDate: string;
  allergies: string[];
  medications: string[];
  conditions: string[];
  codeStatus: string;
  source: Source;
};

const CACHE = (JSON.parse(readFileSync(new URL('./ehr-cache.json', import.meta.url), 'utf8')) as {
  patients: Record<string, Resource[]>;
}).patients;

/** GET from the EHR; null on 404. Throws if the EHR is down or slow (the caller falls back to the cache). */
async function get(path: string): Promise<Bundle | Resource | null> {
  const res = await fetch(`${CONFIG.ehrBaseUrl}${path}`, {
    headers: { Accept: 'application/fhir+json' },
    signal: AbortSignal.timeout(CONFIG.ehrTimeoutMs),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`EHR ${res.status}`);
  return (await res.json()) as Bundle | Resource;
}

const resources = (b: Bundle | Resource | null) => ((b as Bundle | null)?.entry ?? []).map(e => e.resource);
const text = (v: unknown) => (v as { text?: string } | undefined)?.text ?? '';

function patientName(p: Resource): string {
  const n = (p.name as { text?: string; given?: string[]; family?: string }[] | undefined)?.[0];
  return n?.text ?? [...(n?.given ?? []), n?.family ?? ''].join(' ').trim();
}

const toMatch = (p: Resource): PatientMatch => ({ id: p.id, name: patientName(p), birthDate: String(p.birthDate ?? '') });

/** Same rule as the mock server: every word in the query starts some part of the patient's name. */
function nameMatches(p: Resource, query: string) {
  const parts = patientName(p).toLowerCase().split(/\s+/);
  return query.toLowerCase().split(/[\s,]+/).filter(Boolean).every(w => parts.some(x => x.startsWith(w)));
}

export async function searchPatients(name: string, birthDate: string): Promise<{ matches: PatientMatch[]; source: Source }> {
  const q = new URLSearchParams({ name, birthdate: birthDate });
  try {
    return { matches: resources(await get(`/Patient?${q}`)).map(toMatch), source: 'EHR' };
  } catch {
    const matches = Object.values(CACHE)
      .map(rs => rs.find(r => r.resourceType === 'Patient')!)
      .filter(p => nameMatches(p, name) && p.birthDate === birthDate)
      .map(toMatch);
    return { matches, source: 'cached' };
  }
}

/** The patient's record (allergies, medications, conditions, code status), mapped from FHIR by code. */
export async function getRecord(patientRef: string): Promise<EhrRecord | undefined> {
  let rows: Resource[] | undefined;
  let source: Source = 'EHR';
  try {
    const b = await get(`/Patient/${encodeURIComponent(patientRef)}/$everything`);
    if (!b) return undefined;
    rows = resources(b);
  } catch {
    rows = CACHE[patientRef];
    source = 'cached';
  }
  const patient = rows?.find(r => r.resourceType === 'Patient');
  if (!rows || !patient) return undefined;
  const of = (type: string) => rows!.filter(r => r.resourceType === type);
  const codeStatus = (patient.extension as { url: string; valueString?: string }[] | undefined)?.find(
    e => e.url === 'urn:handoff:code-status'
  )?.valueString;
  return {
    patientRef: patient.id,
    name: patientName(patient),
    birthDate: String(patient.birthDate ?? ''),
    allergies: of('AllergyIntolerance').map(r => text(r.code)).filter(Boolean),
    medications: of('MedicationStatement').map(r => text(r.medicationCodeableConcept)).filter(Boolean),
    conditions: of('Condition')
      .map(r => {
        const onset = typeof r.onsetDateTime === 'string' ? r.onsetDateTime.slice(0, 4) : '';
        return text(r.code) + (onset ? ` (${onset})` : '');
      })
      .filter(Boolean),
    codeStatus: codeStatus ?? '',
    source,
  };
}
