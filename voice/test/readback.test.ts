import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseControl, parseIdentity, parseReadback, type ReadbackMatch } from '../src/readback.js';
import { spoken } from '../src/spoken.js';
function match(text: string): ReadbackMatch {
  const result = parseReadback(text);
  assert.ok(result && result.kind !== 'missing_dose', text);
  return result;
}
test('RB1–RB2: spec example table', () => {
  const cases = [
    ['Administering one milligram of epi IO', 'Epinephrine 1 mg IO', 'Copy. Epinephrine, one milligram, I-O.', false],
    ['Giving three hundred of amio', 'Amiodarone 300 mg', 'Copy. Amiodarone, three hundred milligrams.', true],
    ['Pushed point four of Narcan intranasal', 'Naloxone 0.4 mg IN', 'Copy. Naloxone, zero point four milligrams, intranasal.', true],
    ['Shock delivered, two hundred joules', 'Shock 200 J', 'Copy. Shock, two hundred joules.', false],
    ['Giving three hundred milligrams of amiodarone', 'Amiodarone 300 mg', 'Copy. Amiodarone, three hundred milligrams.', false],
    ['Epi ten milligrams', 'Epinephrine 10 mg', 'Copy. Epinephrine, ten milligrams.', false],
  ] as const;
  for (const [input, label, speech, assumed] of cases) {
    const result = match(input);
    assert.equal(result.label, label); assert.equal(result.spoken, speech); assert.equal(result.unitAssumed, assumed);
  }
  assert.deepEqual(parseReadback('Giving epi'), { kind: 'missing_dose', drug: 'epinephrine', eventKind: 'med_epinephrine', spoken: 'Epinephrine. Say again the dose.' });
  assert.equal(parseReadback('Did we give epi yet?'), undefined);
  assert.equal(parseReadback('Get the epi ready'), undefined);
  assert.equal(parseControl('Correction'), 'correction');
});
test('RB1: administration variants, doses, routes and shock', () => {
  const cases = [
    ['one of epi in', 'Epinephrine 1 mg'], ['giving .4 mg nar can IN', 'Naloxone 0.4 mg IN'],
    ['gave 300 mcg epinephrine intravenous', 'Epinephrine 300 mcg IV'], ['pushed 1.5 milliliters of bicarb I-V', 'Sodium bicarbonate 1.5 mL IV'],
    ['giving a hundred fifty milligrams amio IM', 'Amiodarone 150 mg IM'], ['administered 25 grams d50', 'Dextrose 25 g'],
    ['given two units of calcium chloride', 'Calcium chloride 2 units'], ['giving one milligram nitro sublingual', 'Nitroglycerin 1 mg SL'],
    ['giving 2.5 mg albuterol nebulizer', 'Albuterol 2.5 mg neb'], ['shocked at 200', 'Shock 200 J'], ['delivered two hundred joules', 'Shock 200 J'],
  ];
  for (const [input, label] of cases) assert.equal(match(input).label, label, input);
});
test('RB1: questions and plans never trigger', () => {
  for (const line of ['Did we give epi yet?', 'Did you give epi 1 mg', 'Have we given 1 mg epi', 'Should we give epi 1 mg', 'Do we give epi 1 mg', 'Can we give epi 1 mg', 'Could we give epi 1 mg', 'Get the epi ready', 'Draw up 1 mg epi', 'Prepare 1 mg epi', 'Ready the epi', 'Going to give epi 1 mg', 'Gonna give epi 1 mg', "Let’s give epi 1 mg", 'Want to give epi 1 mg', 'What dose epi', 'How much epi', 'Giving epi 1 mg?']) assert.equal(parseReadback(line), undefined, line);
});
test('RB3: whole utterance control intent', () => {
  for (const line of ['correction', 'cancel that', 'cancel', 'scratch that', 'disregard.']) assert.equal(parseControl(line), 'correction');
  for (const line of ['confirm', 'confirmed', 'yes confirm']) assert.equal(parseControl(line), 'confirm');
  for (const line of ['no correction needed on the dose', 'please confirm the dose', 'do not cancel']) assert.equal(parseControl(line), undefined);
});
test('X8: name and valid full date required', () => {
  assert.deepEqual(parseIdentity('Patient is Jordan Avery, born March 14, 1968'), { name: 'Jordan Avery', birthDate: '1968-03-14' });
  assert.deepEqual(parseIdentity("patient's name is jordan avery, DOB 3/14/1968"), { name: 'Jordan Avery', birthDate: '1968-03-14' });
  assert.deepEqual(parseIdentity('this is Jordan Lee Avery date of birth 02/29/2000'), { name: 'Jordan Lee Avery', birthDate: '2000-02-29' });
  assert.equal(parseIdentity('Patient is Jordan Avery, born February 29, 1967'), undefined);
  assert.equal(parseIdentity('Patient is Jordan Avery'), undefined);
  assert.equal(parseIdentity('born March 14, 1968'), undefined);
});
test('§15: decimal digits spoken individually', () => {
  assert.equal(spoken(0.4), 'zero point four'); assert.equal(spoken(1.5), 'one point five'); assert.equal(spoken(0.25), 'zero point two five');
});

test('RB1: negation, unpunctuated questions and planning are not treatment', () => {
  for (const line of [
    'We have not given epi 1 mg', 'Are you giving epi one milligram', 'Epi 1 mg is ready',
    'Never gave epi 1 mg', "We haven't given epi 1 mg", "We didn't give epi 1 mg", "We don't give epi 1 mg",
    'No epi 1 mg given', 'Without epi 1 mg given', 'Hold the epi 1 mg', 'Holding epi 1 mg',
    'Did you give epi 1 mg', 'Do you give epi 1 mg', 'Should you give epi 1 mg', 'Can you give epi 1 mg',
    'Could you give epi 1 mg', 'Will you give epi 1 mg', 'Have we given epi 1 mg', 'Is it epi 1 mg',
    'Epi 1 mg prepared and ready', 'Prepping epi 1 mg', 'Drawing up epi 1 mg', 'Get epi 1 mg',
    'Grab epi 1 mg', 'Set up epi 1 mg', 'Going to give epi 1 mg', 'Gonna give epi 1 mg',
    'Let’s give epi 1 mg', 'Want to give epi 1 mg', 'About to give epi 1 mg', 'Epi 1 mg next',
    'Epi 1 mg for the patient', 'Epi 1 mg yesterday',
  ]) assert.equal(parseReadback(line), undefined, line);
});

test('RB1: unrelated times, ages, percentages and durations do not become doses', () => {
  for (const line of [
    'Giving epi at 14:30', 'Giving epi at 14:30 today', 'Giving epi 30 years', 'Giving epi 30-year-old',
    'Giving epi 30 yo', 'Giving epi 30 percent', 'Giving epi 30%', 'Giving epi 30 minutes',
    'Giving epi 30 min', 'Giving epi 30 seconds', "Giving epi 3 o'clock", 'Giving epi with a delay of 4',
    'Giving epi while 30 years old',
  ]) assert.equal(parseReadback(line)?.kind, 'missing_dose', line);
  for (const line of ['Giving one mg of epi', 'Giving epi 1 mg', 'Giving one mg epi', 'Giving three hundred of amio']) assert.equal(match(line).kind, 'medication', line);
});

test('RB1: shocks require energy and shock or defibrillation context', () => {
  for (const line of ['Delivered 500 mL saline', 'Delivered 500', 'Defibrillated at 200', 'Shock delivered 500 mL']) assert.equal(parseReadback(line), undefined, line);
  for (const line of ['shock delivered, two hundred joules', 'delivered two hundred joules', 'shocked at 200', 'defibrillated 200 J']) assert.equal(match(line).label, 'Shock 200 J', line);
});

test('RB1: negation and plans only count inside the administration clause', () => {
  assert.equal(match('Giving epi one milligram, no allergies').label, 'Epinephrine 1 mg');
  assert.equal(match('Pushed one milligram of epi IO. Not sure about the time.').label, 'Epinephrine 1 mg IO');
  for (const line of ['We have not given epi 1 mg', 'Epi 1 mg not given', 'Get the epi ready, one milligram']) assert.equal(parseReadback(line), undefined, line);
});
