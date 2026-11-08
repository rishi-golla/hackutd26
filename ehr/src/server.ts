// Mock FHIR R4 EHR (spec §17, X2). Read-only, in-memory, synthetic data, no dependencies.
// Run: node src/server.ts   (Node 22.18+ / 24 runs TypeScript directly)
// Base URL: http://<laptop>:4100/fhir
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { STORE, type Resource } from './data.ts';

const PORT = Number(process.env.PORT ?? 4100);
const TYPES = Object.keys(STORE); // Patient, AllergyIntolerance, MedicationStatement, Condition

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/fhir+json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type, Authorization',
  });
  res.end(JSON.stringify(body, null, 2));
}

function outcome(status: number, code: string, text: string) {
  return { status, body: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code, diagnostics: text }] } };
}

function bundle(base: string, resources: Resource[]) {
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total: resources.length,
    entry: resources.map(r => ({ fullUrl: `${base}/${r.resourceType}/${r.id}`, resource: r, search: { mode: 'match' } })),
  };
}

const lower = (s: unknown) => String(s ?? '').toLowerCase();

/** FHIR-style name match: every word in the query starts some part of the patient's name. */
function nameMatches(p: Resource, query: string, part?: 'given' | 'family') {
  const names = (p.name as { given?: string[]; family?: string; text?: string }[]) ?? [];
  const parts = names.flatMap(n =>
    part === 'given' ? n.given ?? [] : part === 'family' ? [n.family ?? ''] : [...(n.given ?? []), n.family ?? '']
  );
  const words = lower(query).split(/[\s,]+/).filter(Boolean);
  return words.every(w => parts.some(x => lower(x).startsWith(w)));
}

/** "pt-0001" or "Patient/pt-0001" → "pt-0001" */
const patientId = (v: string) => v.replace(/^.*Patient\//, '');

function search(type: string, params: URLSearchParams): Resource[] {
  let rows = STORE[type];
  for (const [key, raw] of params) {
    const value = raw.trim();
    if (!value || key.startsWith('_') && key !== '_id') continue; // _count, _format… ignored
    if (key === '_id') rows = rows.filter(r => r.id === value);
    else if (type === 'Patient' && key === 'name') rows = rows.filter(r => nameMatches(r, value));
    else if (type === 'Patient' && (key === 'given' || key === 'family')) rows = rows.filter(r => nameMatches(r, value, key));
    else if (type === 'Patient' && key === 'birthdate') rows = rows.filter(r => r.birthDate === value.replace(/^eq/, ''));
    else if (type === 'Patient' && key === 'gender') rows = rows.filter(r => r.gender === value);
    else if (type === 'Patient' && key === 'identifier') {
      const v = value.split('|').pop();
      rows = rows.filter(r => ((r.identifier as { value: string }[]) ?? []).some(i => i.value === v));
    } else if (type !== 'Patient' && (key === 'patient' || key === 'subject')) {
      const id = patientId(value);
      rows = rows.filter(r => {
        const target = (r.patient ?? r.subject) as { reference?: string } | undefined;
        return target?.reference === `Patient/${id}`;
      });
    }
    // Other parameters are ignored, as FHIR allows for unsupported search parameters.
  }
  return rows;
}

function route(req: IncomingMessage): { status: number; body: unknown } {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const base = `${url.protocol}//${url.host}/fhir`;
  const segments = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);

  if (url.pathname === '/health') return { status: 200, body: { ok: true, patients: STORE.Patient.length } };
  if (segments[0] !== 'fhir') return outcome(404, 'not-found', 'Use /fhir/<ResourceType>');
  const [, type, id, op] = segments;

  if (type === 'metadata') {
    return {
      status: 200,
      body: {
        resourceType: 'CapabilityStatement',
        status: 'active',
        kind: 'instance',
        fhirVersion: '4.0.1',
        format: ['json'],
        software: { name: 'Handoff mock EHR (synthetic data)' },
        rest: [{ mode: 'server', resource: TYPES.map(t => ({ type: t, interaction: [{ code: 'read' }, { code: 'search-type' }] })) }],
      },
    };
  }
  if (!type || !TYPES.includes(type)) return outcome(404, 'not-supported', `Unknown resource type '${type ?? ''}'`);

  if (!id) return { status: 200, body: bundle(base, search(type, url.searchParams)) };

  const found = STORE[type].find(r => r.id === id);
  if (!found) return outcome(404, 'not-found', `${type}/${id} not found`);

  // Patient/<id>/$everything: the patient plus their allergies, medications and conditions.
  if (op === '$everything' && type === 'Patient') {
    const related = TYPES.filter(t => t !== 'Patient').flatMap(t => search(t, new URLSearchParams({ patient: id })));
    return { status: 200, body: { ...bundle(base, [found, ...related]), type: 'searchset' } };
  }
  if (op) return outcome(404, 'not-supported', `Unknown operation '${op}'`);
  return { status: 200, body: found };
}

const server = createServer((req, res) => {
  const t0 = performance.now();
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return send(res, 405, outcome(405, 'not-supported', 'Read-only mock EHR').body);
  let result: { status: number; body: unknown };
  try {
    result = route(req);
  } catch (err) {
    result = outcome(500, 'exception', String(err));
  }
  send(res, result.status, result.body);
  console.log(`${req.method} ${req.url} → ${result.status} (${(performance.now() - t0).toFixed(1)} ms)`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock FHIR R4 EHR (synthetic) on http://localhost:${PORT}/fhir · ${STORE.Patient.length} patients`);
});
