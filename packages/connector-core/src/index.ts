import type { Readable } from 'node:stream';
import type {
  PlaybackFormat,
  Library,
  MediaItem,
  ConnectorServerInfo,
  ConnectorErrorCode,
} from '@openflix/shared';
export type { Library, MediaItem, MediaSource, MediaType } from '@openflix/shared';
export type ConnectionResult =
  { ok: true; serverName: string } | { ok: false; code: ConnectorErrorCode; message: string };
export interface ClientProfile {
  formats: PlaybackFormat[];
}
/** Server-only plan, containing source identity but no tokens or URLs. */
export interface PlaybackInfo {
  itemId: string;
  sourceId: string;
  sessionId: string;
  kind: 'video' | 'audio';
  mode: 'direct';
  contentType: string;
  durationMs: number;
}
export interface PlaybackSession {
  id: string;
  itemId: string;
  sourceId: string;
  positionMs: number;
  durationMs: number;
  paused: boolean;
}
export interface PlaybackStreamRequest {
  method: 'GET' | 'HEAD';
  range?: string;
  signal: AbortSignal;
}
export interface PlaybackStream {
  status: 200 | 206 | 416;
  headers: Readonly<Record<string, string>>;
  body?: Readable;
  cancel(): void;
}
/** IDs returned here are connector-scoped; catalog normalization assigns OpenFlix IDs later. */
export interface MediaConnector {
  connect(): Promise<void>;
  testConnection(): Promise<ConnectionResult>;
  getLibraries(): Promise<Library[]>;
  scanCatalog(
    libraryId: string,
    options?: { pageSize?: number; signal?: AbortSignal },
  ): AsyncIterable<readonly MediaItem[]>;
  getItem(id: string): Promise<MediaItem>;
  search(query: string): Promise<MediaItem[]>;
  getPlaybackInfo(itemId: string, clientProfile: ClientProfile): Promise<PlaybackInfo>;
  openPlaybackStream(plan: PlaybackInfo, request: PlaybackStreamRequest): Promise<PlaybackStream>;
  reportPlaybackStart(session: PlaybackSession): Promise<void>;
  reportPlaybackProgress(session: PlaybackSession): Promise<void>;
  reportPlaybackStop(session: PlaybackSession): Promise<void>;
}
/** Opaque handle only; credentials must not enter connector configuration or client DTOs. */
export interface CredentialRef {
  readonly id: string;
}
/** Implementations must use authenticated encryption with the key outside the DB. */
export interface ConnectorCredentialStore {
  store(connectorId: string, secret: Uint8Array): Promise<CredentialRef>;
  read(ref: CredentialRef): Promise<Uint8Array>;
  delete(ref: CredentialRef): Promise<void>;
}
export class ConnectorNotImplementedError extends Error {
  constructor() {
    super('This operation is outside the implemented connector milestone');
    this.name = 'ConnectorNotImplementedError';
  }
}

export type { ConnectorServerInfo, ConnectorErrorCode } from '@openflix/shared';
export interface ManagedMediaConnector extends MediaConnector {
  getServerInfo(): Promise<ConnectorServerInfo>;
  disconnect(): Promise<void>;
}
const messages: Record<ConnectorErrorCode, string> = {
  invalid_configuration: 'Invalid media server configuration.',
  unavailable: 'Media server is unavailable.',
  timeout: 'Media server request timed out.',
  unauthorized: 'Media server authentication was rejected.',
  unsupported: 'Media server version or operation is unsupported.',
  invalid_response: 'Media server returned an invalid response.',
  unsafe_redirect: 'Media server redirects are not allowed. Use its final base URL.',
  identity_mismatch:
    'Media server identity changed. Remove and re-add this connection after verification.',
  credential_unavailable:
    'Connector credential could not be authenticated. Check the original master key.',
  busy: 'Connector management is busy. Retry shortly.',
  not_found: 'Media server connection was not found.',
};
export class ConnectorError extends Error {
  constructor(readonly code: ConnectorErrorCode) {
    super(messages[code]);
    this.name = 'ConnectorError';
  }
}

/** Workspace deployment may contain separate module instances. Accept only our
 * closed error vocabulary and fixed messages, never arbitrary transport text. */
export function isConnectorError(error: unknown): error is ConnectorError {
  if (!(error instanceof Error) || error.name !== 'ConnectorError' || !('code' in error))
    return false;
  const code = error.code;
  return (
    typeof code === 'string' &&
    Object.hasOwn(messages, code) &&
    error.message === messages[code as ConnectorErrorCode]
  );
}
