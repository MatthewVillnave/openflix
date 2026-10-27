/** OpenFlix HTTP contracts only. Federation is intentionally unimplemented. */
import type { User } from '@openflix/shared';
export const API_PREFIX = '/api/v1' as const;
export interface CurrentUserResponse {
  user: User;
}
export interface LoginRequest {
  username: string;
  password: string;
}
export interface ErrorResponse {
  error: string;
}
export type HealthResponse =
  { status: 'healthy'; database: 'ok' } | { status: 'unhealthy'; database: 'unavailable' };

export type { ConnectorSummary } from '@openflix/shared';
export interface AddConnectorRequest {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
}
export interface ConnectorsResponse {
  connectors: import('@openflix/shared').ConnectorSummary[];
  credentialStorageConfigured: boolean;
  approvedServers: { baseUrl: string; serverId: string; name: string }[];
  canRegisterServers: boolean;
}
export interface ConnectorResponse {
  connector: import('@openflix/shared').ConnectorSummary;
}
export interface RemoveConnectorResponse {
  removed: true;
  revocation: 'confirmed' | 'unconfirmed';
}

export interface CatalogLibrariesResponse {
  libraries: import('@openflix/shared').CatalogLibrary[];
}
export interface CatalogItemResponse {
  item: import('@openflix/shared').CatalogItem;
}
export type CatalogItemsResponse = import('@openflix/shared').CatalogPage;
export type CatalogSyncResponse = import('@openflix/shared').CatalogSyncStatus;
export interface CatalogSyncRequest {
  libraryId?: string;
}

export type { PlaybackView, PlaybackFormat } from '@openflix/shared';

export interface DiscoveryResponse {
  candidates: Array<{ name: string; serverId: string; baseUrl: string }>;
  unavailable: boolean;
}
