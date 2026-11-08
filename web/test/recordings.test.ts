import assert from 'node:assert/strict';
import test from 'node:test';
import type { Event } from '../src/module_bindings/types';
import { recordingFor } from '../src/routes/hospital/recordings';

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
  for (const url of ['javascript:alert(1)', 'http://example.com/video', 'https://user:pass@example.com/video']) {
    assert.equal(recordingFor([recording(1n, url)]), undefined);
  }
  const broken = recording(1n, '');
  broken.sources[0].detail = 'not json';
  assert.equal(recordingFor([broken]), undefined);
});
