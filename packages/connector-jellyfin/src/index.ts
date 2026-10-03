import { ConnectorNotImplementedError } from '@openflix/connector-core';
import type { MediaConnector, CredentialRef, ConnectorCredentialStore } from '@openflix/connector-core';
export interface JellyfinConnectorOptions { baseUrl: string; credential: CredentialRef }
/** Explicitly unavailable. No HTTP requests, credentials, SDK, or simulated connection. */
export function createJellyfinConnector(_options: JellyfinConnectorOptions, _credentials: ConnectorCredentialStore): MediaConnector {
  throw new ConnectorNotImplementedError();
}
