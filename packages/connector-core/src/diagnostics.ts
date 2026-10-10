/** Closed, server-only playback diagnostics. Never attach upstream text, URLs, IDs or headers. */
const stages = [
  'planning',
  'grant_lookup',
  'resource_lookup',
  'upstream_headers',
  'upstream_body',
  'manifest_parse',
  'resource_reference',
  'resource_bounds',
] as const;
const reasons = [
  'malformed_metadata',
  'insufficient_runtime',
  'no_supported_source',
  'inactive_grant',
  'unknown_resource',
  'unexpected_status',
  'unexpected_content_type',
  'unexpected_encoding',
  'invalid_length',
  'invalid_range',
  'response_limit',
  'timeout',
  'cancelled',
  'transport_failure',
  'invalid_manifest',
  'unsupported_directive',
  'unsafe_reference',
  'resource_limit',
  'recursion_limit',
  'invalid_utf8',
  'manifest_line_limit',
  'manifest_output_limit',
  'credential_reflection',
] as const;
const kinds = ['playback_info', 'direct', 'master', 'media', 'segment', 'init'] as const;
const mimeTypes = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'video/mp2t',
  'video/mp4',
  'application/mp4',
  'video/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'application/json',
  'text/html',
  'application/octet-stream',
  'missing',
  'other',
] as const;
const tags = [
  'EXT-X-STREAM-INF',
  'EXTINF',
  'EXT-X-MAP',
  'EXT-X-KEY',
  'EXT-X-MEDIA',
  'other',
] as const;
export interface PlaybackDiagnostic {
  stage: (typeof stages)[number];
  reason: (typeof reasons)[number];
  resourceKind?: (typeof kinds)[number];
  upstreamStatus?: number;
  upstreamContentType?: (typeof mimeTypes)[number];
  manifestTag?: (typeof tags)[number];
}
export function safePlaybackContentType(
  value: string | undefined,
): NonNullable<PlaybackDiagnostic['upstreamContentType']> {
  if (!value) return 'missing';
  const mime = value.split(';', 1)[0]!.trim().toLowerCase();
  return mimeTypes.includes(mime as never) ? (mime as (typeof mimeTypes)[number]) : 'other';
}
/** Reconstruct allowlisted fields even if an error came from another package instance. */
export function safePlaybackDiagnostic(value: unknown): PlaybackDiagnostic | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (!stages.includes(v.stage as never) || !reasons.includes(v.reason as never)) return;
  return Object.freeze({
    stage: v.stage as PlaybackDiagnostic['stage'],
    reason: v.reason as PlaybackDiagnostic['reason'],
    ...(kinds.includes(v.resourceKind as never)
      ? { resourceKind: v.resourceKind as NonNullable<PlaybackDiagnostic['resourceKind']> }
      : {}),
    ...(Number.isInteger(v.upstreamStatus) &&
    Number(v.upstreamStatus) >= 100 &&
    Number(v.upstreamStatus) <= 599
      ? { upstreamStatus: v.upstreamStatus as number }
      : {}),
    ...(mimeTypes.includes(v.upstreamContentType as never)
      ? {
          upstreamContentType: v.upstreamContentType as NonNullable<
            PlaybackDiagnostic['upstreamContentType']
          >,
        }
      : {}),
    ...(tags.includes(v.manifestTag as never)
      ? { manifestTag: v.manifestTag as NonNullable<PlaybackDiagnostic['manifestTag']> }
      : {}),
  });
}
