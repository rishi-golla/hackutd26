import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAllergy, checkDoseRange, composeReadback } from '../src/checks.js';
import { parseReadback, type ReadbackMatch } from '../src/readback.js';
test('RB4: range boundaries and unit conversion', () => {
  for (const [drug, amount, unit] of [['epinephrine', 0.3, 'mg'], ['epinephrine', 1, 'mg'], ['epinephrine', 300, 'mcg'], ['amiodarone', 150, 'mg'], ['amiodarone', 300, 'mg']] as const) assert.equal(checkDoseRange(drug, amount, unit).verdict, 'in_range');
  for (const [drug, amount] of [['epinephrine', 10], ['epinephrine', 0.29], ['amiodarone', 301], ['amiodarone', 149]] as const) assert.equal(checkDoseRange(drug, amount, 'mg').verdict, 'out_of_range');
  assert.deepEqual(checkDoseRange('epinephrine', 1, 'mg'), { verdict: 'in_range', range: '0.3–1 mg' });
  assert.equal(checkDoseRange('fentanyl', 1, 'mg').verdict, 'no_range'); assert.equal(checkDoseRange('epinephrine', 1, 'mL').verdict, 'no_range');
});
test('RB7: allergies, aliases and absence entries', () => {
  for (const [drug, allergy] of [['amio', 'AMIODARONE'], ['aspirin', 'ASA'], ['pcn', 'Penicillin'], ['sulfa', 'sulfonamide antibiotics'], ['magnesium sulfate', 'magnesium']]) assert.equal(checkAllergy(drug, [allergy]).allergic, true);
  for (const entry of ['none', 'NKDA', 'no known allergies', '']) assert.equal(checkAllergy('amiodarone', [entry]).allergic, false);
  assert.equal(checkAllergy('amiodarone', ['penicillin']).allergic, false);
});
test('RB4 and RB7: exact warnings and allergy priority', () => {
  const amio = parseReadback('Giving three hundred milligrams of amiodarone') as ReadbackMatch;
  const epi = parseReadback('Epi ten milligrams') as ReadbackMatch;
  assert.deepEqual(composeReadback(amio, checkDoseRange('amiodarone', 300, 'mg'), checkAllergy('amiodarone', ['amiodarone'])), { spoken: 'Amiodarone, three hundred milligrams. Warning: the record lists an amiodarone allergy. Say confirm or correction.', flagged: true, reason: 'allergy' });
  assert.deepEqual(composeReadback(epi, checkDoseRange('epinephrine', 10, 'mg'), { allergic: false }), { spoken: 'Epinephrine, ten milligrams. Outside the protocol range. Say confirm or correction.', flagged: true, reason: 'dose' });
  assert.equal(composeReadback(epi, checkDoseRange('epinephrine', 10, 'mg'), { allergic: true, match: 'epinephrine' }).reason, 'allergy');
  assert.deepEqual(composeReadback(amio, checkDoseRange('amiodarone', 300, 'mg'), { allergic: false }), { spoken: amio.spoken, flagged: false });
});
