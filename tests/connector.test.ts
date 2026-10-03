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
  expectTypeOf<ReturnType<MediaConnector['scanCatalog']>>().toEqualTypeOf<Promise<MediaItem[]>>();
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
    | 'reportPlaybackStart'
    | 'reportPlaybackProgress'
    | 'reportPlaybackStop'
  >();
});
it('fails explicitly without reading credentials or contacting an upstream', () => {
  const store: ConnectorCredentialStore = { store: vi.fn(), read: vi.fn(), delete: vi.fn() };
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    expect(() =>
      createJellyfinConnector(
        { baseUrl: 'https://unused.invalid', credential: { id: 'opaque-reference' } },
        store,
      ),
    ).toThrow(ConnectorNotImplementedError);
    expect(store.read).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});
