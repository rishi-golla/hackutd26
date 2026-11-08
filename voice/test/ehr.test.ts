import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRecord, searchPatients, spokenRecordSummary } from '../src/ehr.js';
import { ageOn } from '../src/state.js';
import { spoken } from '../src/spoken.js';

const originalFetch = globalThis.fetch;

test('FHIR search extracts patients and record bundle fields', async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/Patient?')) return Response.json({ entry: [{ resource: { resourceType: 'Patient', id: 'pt-0001', name: [{ given: ['Jordan'], family: 'Avery' }], birthDate: '1968-03-14' } }] });
    return Response.json({ entry: [
      { resource: { resourceType: 'Patient', id: 'pt-0001', name: [{ given: ['Jordan'], family: 'Avery' }], birthDate: '1968-03-14', extension: [{ url: 'urn:handoff:code-status', valueString: 'Full code' }] } },
      { resource: { resourceType: 'AllergyIntolerance', code: { text: 'amiodarone' } } },
      { resource: { resourceType: 'MedicationStatement', medicationCodeableConcept: { coding: [{ display: 'warfarin 5 mg' }] } } },
      { resource: { resourceType: 'Condition', code: { coding: [{ display: 'Coronary artery disease' }] } } },
    ] });
  }) as typeof fetch;
  try {
    const patients = await searchPatients('Jordan Avery', '1968-03-14');
    assert.deepEqual(patients, [{ id: 'pt-0001', name: 'Jordan Avery', birthDate: '1968-03-14' }]);
    const record = await fetchRecord('pt-0001');
    assert.deepEqual(record, {
      patientRef: 'pt-0001', name: 'Jordan Avery', birthDate: '1968-03-14', allergies: ['amiodarone'],
      medications: ['warfarin 5 mg'], conditions: ['Coronary artery disease'], codeStatus: 'Full code', source: 'EHR',
    });
    const age = ageOn('1968-03-14');
    assert.equal(spokenRecordSummary(record), `Record found. Jordan Avery, ${spoken(age!)}. Allergy: amiodarone. On warfarin.`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pt-0001 falls back to the cached record and labels it cached when fetch fails', async () => {
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
  const oldWarn = console.warn;
  console.warn = () => {};
  try {
    const record = await fetchRecord('pt-0001');
    assert.equal(record.source, 'cached');
    assert.deepEqual(record.allergies, ['amiodarone']);
    assert.deepEqual(record.medications, ['warfarin', 'metoprolol']);
    const age = ageOn('1968-03-14');
    assert.equal(spokenRecordSummary(record), `Record found. Jordan Avery, ${spoken(age!)}. Allergy: amiodarone. On warfarin.`);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = oldWarn;
  }
});
