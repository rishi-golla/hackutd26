// What the camera saw (spec §19 Vision, RB8–RB10, X1). The vision sampler in voice/pipecat/vision.py posts one
// finding at a time to POST /seen; this module turns it into the rows the camera lane would otherwise write:
// an ID card becomes the W6 search (name + birth date → identify_patient, method "ID card"), a drug being given
// becomes log_event(med_<drug>, source "seen") with the printed dose in the label and never a guessed one,
// and AED pads / airway / IV-IO become procedure rows with source "seen".
import { recognizeDrug } from './readback.js';

export type SeenFinding =
  | { type: 'id_card'; name: string; birthDate: string; confidence?: number; detail?: string }
  | { type: 'medication'; drug: string; dose?: string; confidence?: number; detail?: string }
  | { type: 'aed_pads' | 'airway_device' | 'iv_io'; confidence?: number; detail?: string };

const PROCEDURES: Record<'aed_pads' | 'airway_device' | 'iv_io', { kind: string; label: string }> = {
  aed_pads: { kind: 'procedure', label: 'AED pads on' },
  airway_device: { kind: 'airway', label: 'Airway device placed' },
  iv_io: { kind: 'procedure', label: 'IV/IO access' },
};

const title = (s: string) => s.replace(/\b[a-z]/g, c => c.toUpperCase());

/** "AVERY, JORDAN" or "jordan avery" → "Jordan Avery". */
export function personName(raw: string): string {
  let name = raw.replace(/\s+/g, ' ').trim();
  if (name.includes(',')) {
    const [last, first] = name.split(',', 2).map(p => p.trim());
    name = `${first} ${last}`;
  }
  return title(name.toLowerCase());
}

/** The request body of POST /seen, validated; undefined when it isn't a finding we act on. */
export function parseSeen(body: Record<string, unknown>): SeenFinding | undefined {
  const type = String(body.type ?? '');
  const confidence = body.confidence === undefined ? undefined : Number(body.confidence);
  const detail = body.detail === undefined ? undefined : String(body.detail).slice(0, 200);
  if (type === 'id_card') {
    const name = personName(String(body.name ?? ''));
    const birthDate = String(body.birthDate ?? body.birth_date ?? '').trim();
    if (!/^[A-Za-z][A-Za-z'’-]* [A-Za-z][A-Za-z'’ -]*$/.test(name) || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return undefined;
    return { type, name, birthDate, confidence, detail };
  }
  if (type === 'medication') {
    const drug = String(body.drug ?? '').trim();
    if (!drug) return undefined;
    const dose = body.dose === undefined || body.dose === null ? undefined : String(body.dose).trim().slice(0, 24) || undefined;
    return { type, drug, dose, confidence, detail };
  }
  if (type === 'aed_pads' || type === 'airway_device' || type === 'iv_io') return { type, confidence, detail };
  return undefined;
}

/**
 * The event row for a non-identity finding. The drug name goes through the read-back parser's alias and fuzzy
 * matching ("epi" → epinephrine, "epinephrin" → epinephrine); a name it doesn't know is not logged.
 */
export function seenEvent(f: Exclude<SeenFinding, { type: 'id_card' }>): { kind: string; label: string } | undefined {
  if (f.type !== 'medication') return PROCEDURES[f.type];
  const drug = recognizeDrug(f.drug) ?? recognizeDrug(`giving ${f.drug}`);
  if (!drug) return undefined;
  const dose = f.dose?.replace(/\s+/g, ' ').trim();
  return { kind: `med_${drug.replace(/ /g, '_')}`, label: dose ? `${title(drug)} ${dose}` : title(drug) };
}
