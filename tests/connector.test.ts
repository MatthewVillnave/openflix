import { expect, expectTypeOf, it, vi } from 'vitest';
import type {
  MediaConnector,
  ConnectorCredentialStore,
  ConnectionResult,
  MediaItem,
} from '../packages/connector-core/dist/index.js';
import { ConnectorNotImplementedError } from '../packages/connector-core/dist/index.js';
import { createJellyfinConnector } from '../packages/connector-jellyfin/dist/index.js';
it('preserves the normalized async connector contract at compile time', () => {
  expectTypeOf<ReturnType<MediaConnector['scanCatalog']>>().toEqualTypeOf<
    AsyncIterable<readonly MediaItem[]>
  >();
  expectTypeOf<ReturnType<MediaConnector['testConnection']>>().toEqualTypeOf<
    Promise<ConnectionResult>
  >();
  expectTypeOf<Parameters<MediaConnector['getItem']>>().toEqualTypeOf<[id: string]>();
  expectTypeOf<keyof MediaConnector>().toEqualTypeOf<
    | 'connect'
    | 'testConnection'
    | 'getLibraries'
    | 'scanCatalog'
    | 'getItem'
    | 'search'
    | 'getPlaybackInfo'
    | 'openPlaybackStream'
    | 'reportPlaybackStart'
    | 'reportPlaybackProgress'
    | 'reportPlaybackStop'
  >();
});
it('defers later operations without reading credentials or contacting an upstream', async () => {
  const store: ConnectorCredentialStore = { store: vi.fn(), read: vi.fn(), delete: vi.fn() };
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    const connector = createJellyfinConnector(
      { baseUrl: 'https://unused.invalid', credential: { id: 'opaque-reference' } },
      store,
    );
    await expect(connector.search('unused')).rejects.toThrow(ConnectorNotImplementedError);
    expect(store.read).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});
