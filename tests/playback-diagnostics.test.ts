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
it('preserves only fixed reference-rule labels and discards injected values', () => {
  expect(
    safePlaybackDiagnostic({
      stage: 'resource_reference',
      reason: 'unsafe_reference',
      referenceRule: 'query_option',
      query: 'api_key=secret',
    }),
  ).toEqual({
    stage: 'resource_reference',
    reason: 'unsafe_reference',
    referenceRule: 'query_option',
  });
  expect(
    safePlaybackDiagnostic({
      stage: 'resource_reference',
      reason: 'unsafe_reference',
      referenceRule: 'https://private.invalid/?token=secret',
    }),
  ).toEqual({ stage: 'resource_reference', reason: 'unsafe_reference' });
});
it('logs only public fixed query-option names, never arbitrary input names or values', () => {
  const base = { stage: 'resource_reference', reason: 'unsafe_reference' };
  expect(safePlaybackDiagnostic({ ...base, queryOption: 'subtitlemethod' })).toMatchObject({
    queryOption: 'subtitlemethod',
  });
  expect(
    safePlaybackDiagnostic({ ...base, queryOption: 'private-token', value: 'secret' }),
  ).toEqual(base);
});

it('bounds combined subtitle issues to a fixed deduplicated vocabulary', () => {
  const base = { stage: 'resource_reference', reason: 'unsafe_reference' };
  expect(
    safePlaybackDiagnostic({
      ...base,
      subtitleIssues: ['index', 'secret', 'index', 'codec'],
      url: 'secret',
    }),
  ).toEqual({ ...base, subtitleIssues: ['codec', 'index'] });
  expect(safePlaybackDiagnostic({ ...base, subtitleIssues: 'private' })).toEqual(base);
});

it('limits input constraints to fixed categories without source metadata leakage', () => {
  const base = { stage: 'planning', reason: 'no_supported_source' };
  expect(
    safePlaybackDiagnostic({
      ...base,
      sourceConstraints: ['dimensions', 'private-secret', 'dimensions'],
      source: 'private-path',
    }),
  ).toEqual({ ...base, sourceConstraints: ['dimensions'] });
});
