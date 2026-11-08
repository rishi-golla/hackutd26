import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberWordsToDigits, numbersSupported } from '../src/llm.js';

test('number words are normalised before the facts-only check', () => {
  for (const [words, digits] of [
    ['Heart rate two hundred.', '200'], ['one hundred and five', '105'], ['a hundred fifty', '150'], ['one fifty-five', '155'],
    ['one oh four', '104'], ['eighty-eight', '88'], ['thirty-six point four', '36.4'], ['one milligram', '1'],
  ] as const) assert.ok(numberWordsToDigits(words).includes(digits), `${words} → ${numberWordsToDigits(words)}`);
  assert.equal(numbersSupported('Heart rate two hundred.', 'VITALS no data'), false);
  assert.equal(numbersSupported('Heart rate one hundred and five.', 'HR 100 · relay 5 s ago'), false);
  assert.equal(numbersSupported('Heart rate one oh four.', 'HR 104'), true);
  assert.equal(numbersSupported('SpO2 ninety-three (experimental)', 'SpO2 93 (experimental)'), true);
});
