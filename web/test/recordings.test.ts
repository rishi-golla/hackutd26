import assert from 'node:assert/strict';
import test from 'node:test';
import type { Event } from '../src/module_bindings/types';
import { isRecordedEncounter, recordingFor } from '../src/routes/hospital/recordings';

const recording = (id: bigint, url: string, status = 'logged') => ({
  id, kind: 'session_recording', status, sources: [{ kind: 'recording', detail: JSON.stringify({ url, label: 'Demo' }) }],
}) as Event;

test('recording replacement/removal follows the newest non-cancelled reference', () => {
  const older = recording(1n, 'https://example.com/one.mp4');
  assert.equal(recordingFor([older, recording(2n, 'https://example.com/two.webm')])?.url, 'https://example.com/two.webm');
  assert.equal(recordingFor([older, recording(2n, '')]), undefined);
  assert.equal(recordingFor([older, recording(2n, '', 'cancelled')])?.url, 'https://example.com/one.mp4');
});

test('unsafe or malformed references cannot become playback URLs', () => {
  for (const url of ['javascript:alert(1)', 'http://example.com/video', 'https://user:pass@example.com/video',
    '//example.com/video.mp4', '/recordings/../secret.mp4', '/recordings/%2e%2e/secret.mp4', '/recordings/clip.mp4?redirect=evil']) {
    assert.equal(recordingFor([recording(1n, url)]), undefined);
  }
  const broken = recording(1n, '');
  broken.sources[0].detail = 'not json';
  assert.equal(recordingFor([broken]), undefined);
});

test('local demo files use only the scoped recordings directory', () => {
  assert.equal(recordingFor([recording(1n, '/recordings/patient-01.mp4')])?.url, '/recordings/patient-01.mp4');
  assert.equal(recordingFor([recording(1n, '/recordings/patient-02.webm')])?.url, '/recordings/patient-02.webm');
});

test('closed video imports are excluded from clinical selectors, but live calls remain eligible', () => {
  assert.equal(isRecordedEncounter({ unit: 'Recorded session', status: 'closed' }), true);
  assert.equal(isRecordedEncounter({ unit: 'Medic 12', status: 'closed' }), false);
  assert.equal(isRecordedEncounter({ unit: 'Recorded session', status: 'on_scene' }), false);
});
