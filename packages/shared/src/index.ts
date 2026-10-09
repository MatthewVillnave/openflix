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
  type?: LibraryType;
  upstreamType?: string | null;
}
export const mediaTypes = [
  'movie',
  'series',
  'season',
  'episode',
  'audio',
  'album',
  'artist',
  'playlist',
  'unknown',
  'music',
] as const;
export type MediaType = (typeof mediaTypes)[number];
export type LibraryType = 'movie' | 'television' | 'music' | 'playlist' | 'mixed' | 'unknown';
export interface MediaItem {
  id: string;
  libraryId: string;
  type: MediaType;
  title: string;
  sortTitle?: string;
  upstreamType?: string;
  /** Known structural container; contributes no semantic library family. */
  structural?: true;
  releaseDate?: string;
  parentId?: string;
  seriesId?: string;
  seasonId?: string;
  albumId?: string;
  artistIds?: string[];
  albumArtistIds?: string[];
  albumTitle?: string;
  revision?: string;
  createdAt?: string;
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

export interface CatalogLibrary {
  id: string;
  connectorId: string;
  connectorName: string;
  upstreamId: string;
  name: string;
  type: LibraryType;
  upstreamType: string | null;
  lastSyncedAt: number;
}
/** Relationship IDs are OpenFlix source-scoped IDs, possibly unresolved if not enumerated. */
export interface CatalogItem extends Omit<MediaItem, 'libraryId'> {
  connectorId: string;
  upstreamId: string;
  libraryIds: string[];
  syncedAt: number;
}
export interface CatalogPage {
  items: CatalogItem[];
  offset: number;
  limit: number;
  total: number;
}
export interface CatalogSyncStatus {
  connectorId: string;
  state: 'never' | 'syncing' | 'successful' | 'failed';
  startedAt: number | null;
  finishedAt: number | null;
  lastSuccessfulAt: number | null;
  error: ConnectorErrorCode | null;
  libraryId: string | null;
}

/** Explicit browser capabilities; no client-selected upstream URL/source. */
export type PlaybackMode = 'direct' | 'remux' | 'transcode';
export const playbackFormats = {
  'hls-h264-aac': 'application/vnd.apple.mpegurl',
  'mp4-h264-aac': 'video/mp4; codecs="avc1.640029, mp4a.40.2"',
  'webm-vp8-opus': 'video/webm; codecs="vp8, opus"',
  mp3: 'audio/mpeg',
  wav: 'audio/wav; codecs="1"',
} as const;
export type PlaybackFormat = keyof typeof playbackFormats;
export interface PlaybackView {
  id: string;
  itemId: string;
  kind: 'video' | 'audio';
  mode: PlaybackMode;
  contentType: string;
  durationMs: number;
  expiresAt: number;
  streamPath: string;
}
