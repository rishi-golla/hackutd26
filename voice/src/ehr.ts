// W6: the mock FHIR R4 EHR (spec §17). Search by name + birth date, pull Patient/$everything, and a cached copy of
// the demo patient for when the server doesn't answer (X7, labelled "cached").
import { CONFIG } from './config';
import { ageOn } from './state';
import { spoken } from './spoken';

export type EhrPatient = { id: string; name: string; birthDate: string };
export type EhrRecord = {
  patientRef: string;
  name: string;
  birthDate: string;
  allergies: string[];
  medications: string[];
  conditions: string[];
  codeStatus: string;
  source: 'EHR' | 'cached';
};

type Fhir = { resourceType?: string; id?: string; [k: string]: unknown };

const TIMEOUT_MS = 2500;

async function get(path: string): Promise<Fhir> {
  const res = await fetch(`${CONFIG.ehrBaseUrl}${path}`, { headers: { Accept: 'application/fhir+json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`EHR ${res.status} for ${path}`);
  return (await res.json()) as Fhir;
}

const entries = (bundle: Fhir): Fhir[] =>
  Array.isArray(bundle.entry) ? (bundle.entry as { resource?: Fhir }[]).map(e => e.resource ?? {}) : [];

function patientName(p: Fhir): string {
  const names = (p.name as { given?: string[]; family?: string; text?: string }[] | undefined) ?? [];
  const n = names[0];
  if (!n) return '';
  return n.text ?? [...(n.given ?? []), n.family ?? ''].join(' ').trim();
}

const codeText = (r: Fhir, key: string): string | undefined => {
  const c = r[key] as { text?: string; coding?: { display?: string }[] } | undefined;
  return c?.text ?? c?.coding?.[0]?.display;
};

/** FHIR Patient?name=&birthdate= (X8: both are required before searching). */
export async function searchPatients(name: string, birthDate?: string): Promise<EhrPatient[]> {
  const q = new URLSearchParams({ name });
  if (birthDate) q.set('birthdate', birthDate);
  const bundle = await get(`/Patient?${q}`);
  return entries(bundle)
    .filter(r => r.resourceType === 'Patient' && typeof r.id === 'string')
    .map(p => ({ id: p.id as string, name: patientName(p), birthDate: String(p.birthDate ?? '') }));
}

/** Patient/<id>/$everything → one record. Falls back to the cached copy (source "cached") if the EHR is down. */
export async function fetchRecord(patientId: string): Promise<EhrRecord> {
  try {
    const bundle = await get(`/Patient/${encodeURIComponent(patientId)}/$everything`);
    const rows = entries(bundle);
    const patient = rows.find(r => r.resourceType === 'Patient');
    if (!patient) throw new Error('no Patient in $everything');
    const ext = (patient.extension as { url?: string; valueString?: string }[] | undefined) ?? [];
    return {
      patientRef: patientId,
      name: patientName(patient),
      birthDate: String(patient.birthDate ?? ''),
      allergies: rows.filter(r => r.resourceType === 'AllergyIntolerance').map(r => codeText(r, 'code') ?? '').filter(Boolean),
      medications: rows.filter(r => r.resourceType === 'MedicationStatement').map(r => codeText(r, 'medicationCodeableConcept') ?? '').filter(Boolean),
      conditions: rows.filter(r => r.resourceType === 'Condition').map(r => codeText(r, 'code') ?? '').filter(Boolean),
      codeStatus: ext.find(e => e.url === 'urn:handoff:code-status')?.valueString ?? '',
      source: 'EHR',
    };
  } catch (err) {
    const cached = CACHED[patientId];
    if (!cached) throw err;
    console.warn(`[voice] EHR unavailable (${(err as Error).message}); using the cached copy of ${patientId}`);
    return { ...cached, source: 'cached' };
  }
}

/** X7 for the spoken-identity path: the cached record only when the name and birth date match it exactly. */
export function cachedMatch(name: string, birthDate: string): EhrRecord | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  return Object.values(CACHED).find(r => norm(r.name) === norm(name) && r.birthDate === birthDate);
}

/** X4: name, age, allergies, one key medication; facts only, under 12 words after the name. */
export function spokenRecordSummary(r: EhrRecord | { name: string; birthDate: string; allergies: string[]; medications: string[] }): string {
  const age = ageOn(r.birthDate);
  const parts = [`Record found. ${r.name}${age !== undefined ? `, ${spoken(age)}` : ''}.`];
  parts.push(r.allergies.length ? `Allergy: ${r.allergies.slice(0, 2).join(' and ')}.` : 'No known allergies.');
  const med = r.medications[0]?.split(/\s+/)[0];
  if (med) parts.push(`On ${med}.`);
  return parts.join(' ');
}

/** The demo patient, saved from GET /fhir/Patient/pt-0001/$everything (spec §17 X7). Synthetic. */
const CACHED: Record<string, EhrRecord> = {
  'pt-0001': {
    patientRef: 'pt-0001',
    name: 'Jordan Avery',
    birthDate: '1968-03-14',
    allergies: ['amiodarone'],
    medications: ['warfarin', 'metoprolol'],
    conditions: ['Coronary artery disease', 'Myocardial infarction'],
    codeStatus: 'Full code',
    source: 'cached',
  },
};
