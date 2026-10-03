import type { Library, MediaItem } from '@openflix/shared';
export type { Library, MediaItem, MediaSource } from '@openflix/shared';
export type ConnectionResult = { ok: true; serverName: string } | { ok: false; code: 'unavailable' | 'unauthorized' | 'unsupported'; message: string };
export interface ClientProfile { videoCodecs: string[]; audioCodecs: string[]; maxWidth: number; maxHeight: number }
/** Server-only transport information. Never serialize this object to a browser. */
export interface PlaybackInfo { url: string; headers: Readonly<Record<string, string>>; mode: 'direct' | 'transcode'; expiresAt: number }
export interface PlaybackSession { id: string; itemId: string; positionMs: number; durationMs: number; paused: boolean }
/** IDs returned here are connector-scoped; catalog normalization assigns OpenFlix IDs later. */
export interface MediaConnector {
  connect(): Promise<void>;
  testConnection(): Promise<ConnectionResult>;
  getLibraries(): Promise<Library[]>;
  scanCatalog(): Promise<MediaItem[]>;
  getItem(id: string): Promise<MediaItem>;
  search(query: string): Promise<MediaItem[]>;
  getPlaybackInfo(itemId: string, clientProfile: ClientProfile): Promise<PlaybackInfo>;
  reportPlaybackStart(session: PlaybackSession): Promise<void>;
  reportPlaybackProgress(session: PlaybackSession): Promise<void>;
  reportPlaybackStop(session: PlaybackSession): Promise<void>;
}
/** Opaque handle only; credentials must not enter connector configuration or client DTOs. */
export interface CredentialRef { readonly id: string }
/** Milestone 2 must implement authenticated encryption, with its key outside the DB. */
export interface ConnectorCredentialStore {
  store(connectorId: string, secret: Uint8Array): Promise<CredentialRef>;
  read(ref: CredentialRef): Promise<Uint8Array>;
  delete(ref: CredentialRef): Promise<void>;
}
export class ConnectorNotImplementedError extends Error {
  constructor() { super('Jellyfin integration is deferred to Milestone 2'); this.name = 'ConnectorNotImplementedError'; }
}
