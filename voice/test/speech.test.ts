import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeSpeech } from '../src/speech.js';

test('looksLikeSpeech: short conversational answers pass', () => {
  for (const ok of [
    'Not documented yet.',
    'Epinephrine was given at fourteen oh four, one milligram.',
    'I read back doses, check allergies, pull the record and log what you tell me.',
    'Nothing given yet.',
    'Say again?',
  ]) assert.equal(looksLikeSpeech(ok), true, ok);
});

test('looksLikeSpeech: reasoning, JSON, lists, markdown, tool talk and long paragraphs fail', () => {
  const blob = 'KEEP. The medic is describing the patient. DOCUMENT: log_event finding "Skin pale and sweaty". REPLY: not meant for Handoff, so stay silent.';
  const sixty = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  for (const bad of [
    blob,
    'Document the finding quietly; the medic did not ask anything.',
    'The medic is talking to the patient, so I should not reply.',
    'Let me check the timeline first.',
    'I should log this as a finding.',
    '{"advisory": null, "summary": "Continuing to monitor."}',
    'Given so far:\n- Epinephrine 1 mg\n- Amiodarone 300 mg',
    'Steps:\n1. Log the finding\n2. Stay silent',
    '## Decision\nKeep the line.',
    '```\nSILENT\n```',
    'Calling log_event for the finding.',
    'The state shows no record yet.',
    'Checked the voice log for context.',
    sixty,
    '',
  ]) assert.equal(looksLikeSpeech(bad), false, bad.slice(0, 40));
});
