/** Backend-independent normalized domain types. No upstream API DTOs. */
export interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}
export interface Library {
  id: string;
  name: string;
  mediaTypes: MediaType[];
}
export type MediaType = 'movie' | 'series' | 'season' | 'episode' | 'music';
export interface MediaItem {
  id: string;
  libraryId: string;
  type: MediaType;
  title: string;
  year?: number;
  providerIds: Readonly<Record<string, string>>;
  runtimeSeconds?: number;
  seasonNumber?: number;
  episodeNumber?: number;
}
export interface MediaSource {
  id: string;
  catalogItemId: string;
  connectorId: string;
  remoteItemId: string;
  availability: 'online' | 'offline' | 'unknown';
}

export interface ConnectorServerInfo {
  id: string;
  name: string;
  version: string;
}
export type ConnectorErrorCode =
  | 'invalid_configuration'
  | 'unavailable'
  | 'timeout'
  | 'unauthorized'
  | 'unsupported'
  | 'invalid_response'
  | 'unsafe_redirect'
  | 'identity_mismatch'
  | 'credential_unavailable'
  | 'busy'
  | 'not_found';
/** Safe administrative projection. No credential material belongs here. */
export interface ConnectorSummary {
  id: string;
  type: 'jellyfin';
  name: string;
  baseUrl: string;
  server: ConnectorServerInfo;
  libraries: Library[];
  state: 'unverified' | 'connected' | 'error';
  lastError: ConnectorErrorCode | null;
  lastCheckedAt: number | null;
  createdAt: number;
}
