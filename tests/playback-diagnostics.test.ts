import { expect, it } from 'vitest';
import {
  ConnectorError,
  safePlaybackDiagnostic,
  safePlaybackContentType,
} from '../packages/connector-core/dist/index.js';
it('reconstructs only bounded diagnostic values and discards arbitrary private fields', () => {
  const diagnostic = safePlaybackDiagnostic({
    stage: 'manifest_parse',
    reason: 'invalid_manifest',
    resourceKind: 'media',
    upstreamStatus: 200,
    upstreamContentType: 'text/private-token',
    manifestTag: 'PRIVATE-TOKEN',
    url: 'https://private/token',
    token: 'private-token',
  });
  expect(diagnostic).toEqual({
    stage: 'manifest_parse',
    reason: 'invalid_manifest',
    resourceKind: 'media',
    upstreamStatus: 200,
  });
  expect(JSON.stringify(diagnostic)).not.toContain('private');
  expect(Object.isFrozen(diagnostic)).toBe(true);
  expect(safePlaybackDiagnostic({ stage: 'secret', reason: 'invalid_manifest' })).toBeUndefined();
  expect(safePlaybackDiagnostic({ stage: 'planning', reason: 'secret' })).toBeUndefined();
});
it('normalizes content types to a closed vocabulary and preserves fixed error messages', () => {
  expect(safePlaybackContentType('text/html; private-token=secret')).toBe('text/html');
  expect(safePlaybackContentType('text/private-token')).toBe('other');
  expect(safePlaybackContentType(undefined)).toBe('missing');
  expect(
    new ConnectorError('invalid_response', { stage: 'planning', reason: 'malformed_metadata' })
      .message,
  ).toBe(new ConnectorError('invalid_response').message);
});
