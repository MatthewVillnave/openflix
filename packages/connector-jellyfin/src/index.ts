import type { LibraryApi } from '@jellyfin/sdk/lib/generated-client/api/library-api.js';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api.js';
import { normalizeItem, pageSchema } from './catalog.js';
import { Jellyfin } from '@jellyfin/sdk/lib/jellyfin.js';
import type { Api as JellyfinApi } from '@jellyfin/sdk/lib/api.js';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api.js';
import { getAuthenticationApi } from '@jellyfin/sdk/lib/utils/api/authentication-api.js';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api.js';
import { getUserViewApi } from '@jellyfin/sdk/lib/utils/api/user-view-api.js';
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api.js';
import axios from 'axios';
import { z } from 'zod';
import {
  ConnectorError,
  ConnectorNotImplementedError,
  isConnectorError,
} from '@openflix/connector-core';
import type {
  ManagedMediaConnector,
  CredentialRef,
  ConnectorCredentialStore,
  ConnectorServerInfo,
  Library,
  ConnectionResult,
  MediaItem,
  PlaybackInfo,
  MediaType,
} from '@openflix/connector-core';

const identifier = z.string().regex(/^[a-fA-F0-9-]{16,64}$/);
const infoSchema = z.object({
  Id: identifier,
  ServerName: z.string().min(1).max(256),
  Version: z.string().max(64),
});
const userSchema = z.object({ Id: identifier });
const credentialSchema = z.object({
  version: z.literal(1),
  token: z.string().regex(/^[A-Za-z0-9._~-]{16,4096}$/),
  userId: identifier,
  serverId: identifier,
});
const librarySchema = z.object({
  TotalRecordCount: z.number().int().nonnegative().optional(),
  Items: z
    .array(
      z.object({
        Id: identifier,
        Name: z.string().min(1).max(256),
        CollectionType: z.string().max(64).nullish(),
      }),
    )
    .max(1000),
});

/** Administrator-trusted HTTP(S) destinations, including LAN hosts and base paths. */
export function validateJellyfinUrl(value: string): string {
  try {
    if (value.length > 2048 || !/^https?:\/\//i.test(value) || /[\s\\?#@\u0000-\u001f]/.test(value))
      throw new Error();
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    // Restrict base paths to literal segments, excluding encoded separators/dot segments.
    const rawPath = value.replace(/^https?:\/\/[^/]+/i, '');
    if (rawPath && !/^(?:\/[A-Za-z0-9_-]+)*\/?$/.test(rawPath)) throw new Error();
    return url.href.replace(/\/$/, '');
  } catch {
    throw new ConnectorError('invalid_configuration');
  }
}
function normalized(error: unknown): ConnectorError {
  if (isConnectorError(error)) return error;
  if (error instanceof z.ZodError) return new ConnectorError('invalid_response');
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status && status >= 300 && status < 400) return new ConnectorError('unsafe_redirect');
    if (status === 401 || status === 403) return new ConnectorError('unauthorized');
    if (['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'].includes(error.code ?? ''))
      return new ConnectorError('timeout');
    if (status && status >= 400 && status < 500) return new ConnectorError('invalid_response');
    return new ConnectorError('unavailable');
  }
  return new ConnectorError('invalid_response');
}
function apiFor(baseUrl: string, deviceId: string, token = ''): JellyfinApi {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(deviceId)) throw new ConnectorError('invalid_configuration');
  const transport = axios.create({
    adapter: 'http',
    proxy: false,
    timeout: 5000,
    maxRedirects: 0,
    maxContentLength: 1024 * 1024,
    maxBodyLength: 8192,
    headers: { Accept: 'application/json; profile="PascalCase"' },
  });
  // Absolute deadline also bounds slow/dripping responses, not just socket inactivity.
  transport.interceptors.request.use((config) => {
    config.signal =
      config.signal instanceof AbortSignal
        ? AbortSignal.any([config.signal, AbortSignal.timeout(5000)])
        : AbortSignal.timeout(5000);
    return config;
  });
  return new Jellyfin({
    clientInfo: { name: 'OpenFlix', version: '0.1.0' },
    deviceInfo: { name: 'OpenFlix connector', id: deviceId },
  }).createApi(validateJellyfinUrl(baseUrl), token, transport);
}
type Api = ReturnType<typeof apiFor>;
// SDK 1.0.0 augmentation declarations omit NodeNext extensions; runtime inherits these exact generated methods.
const catalogApi = (api: Api) =>
  getLibraryApi(api) as unknown as Pick<LibraryApi, 'getItems' | 'getItem'>;
async function serverInfo(api: Api): Promise<ConnectorServerInfo> {
  const data = infoSchema.parse((await getSystemApi(api).getPublicSystemInfo()).data);
  if (!/^(12\.\d+\.\d+|10\.11\.\d+)(?:[-+].*)?$/.test(data.Version))
    throw new ConnectorError('unsupported');
  return { id: data.Id, name: data.ServerName, version: data.Version };
}
async function libraries(api: Api, userId: string): Promise<Library[]> {
  const result = librarySchema.parse(
    (
      await getUserViewApi(api).getUserViews({
        userId,
        includeHidden: false,
        includeExternalContent: false,
      })
    ).data,
  );
  if (result.TotalRecordCount !== undefined && result.TotalRecordCount !== result.Items.length)
    throw new ConnectorError('invalid_response');
  if (new Set(result.Items.map((v) => v.Id)).size !== result.Items.length)
    throw new ConnectorError('invalid_response');
  const types: Record<string, MediaType[]> = {
    movies: ['movie'],
    tvshows: ['series', 'season', 'episode'],
    music: ['music'],
    playlists: ['playlist'],
  };
  return result.Items.map((item) => ({
    id: item.Id,
    name: item.Name,
    upstreamType: item.CollectionType ?? null,
    type:
      (
        {
          movies: 'movie',
          tvshows: 'television',
          music: 'music',
          playlists: 'playlist',
          mixed: 'mixed',
        } as Record<string, Library['type']>
      )[
        Object.hasOwn(types, item.CollectionType ?? '') || item.CollectionType === 'mixed'
          ? item.CollectionType!
          : ''
      ] ?? 'unknown',
    mediaTypes: Object.hasOwn(types, item.CollectionType ?? '')
      ? types[item.CollectionType ?? '']!
      : [],
  }));
}
function noSecretEcho(value: unknown, secrets: string[]): void {
  const serialized = JSON.stringify(value);
  if (secrets.some((secret) => secret.length > 0 && serialized.includes(secret)))
    throw new ConnectorError('invalid_response');
}
export interface JellyfinConnectorOptions {
  baseUrl: string;
  credential: CredentialRef;
}
/** Opaque bytes are server-only. The caller must encrypt them and clear the buffer. */
export async function authenticateJellyfin(input: {
  baseUrl: string;
  deviceId: string;
  username: string;
  password: string;
}): Promise<{ server: ConnectorServerInfo; libraries: Library[]; secret: Uint8Array }> {
  if (
    !input.username.trim() ||
    input.username.length > 256 ||
    Buffer.byteLength(input.password) > 1024 ||
    !input.password
  )
    throw new ConnectorError('invalid_configuration');
  const api = apiFor(input.baseUrl, input.deviceId);
  let token = '';
  try {
    const server = await serverInfo(api);
    const response = await getAuthenticationApi(api).authenticateUserByName({
      authenticateUserByName: { Username: input.username, Pw: input.password },
    });
    const data = z
      .object({ AccessToken: credentialSchema.shape.token, User: userSchema, ServerId: identifier })
      .parse(response.data);
    token = data.AccessToken;
    if (data.ServerId !== server.id) throw new ConnectorError('identity_mismatch');
    const available = await libraries(api, data.User.Id);
    noSecretEcho({ server, libraries: available }, [input.password, token]);
    return {
      server,
      libraries: available,
      secret: Buffer.from(
        JSON.stringify({ version: 1, token, userId: data.User.Id, serverId: server.id }),
      ),
    };
  } catch (error) {
    if (api.accessToken) {
      try {
        await getSessionApi(api).reportSessionEnded();
      } catch {
        /* best effort revoke only this newly issued session */
      }
    }
    throw normalized(error);
  } finally {
    token = '';
    api.update({ accessToken: '' });
  }
}

export function createJellyfinConnector(
  options: JellyfinConnectorOptions,
  credentials: ConnectorCredentialStore,
): ManagedMediaConnector {
  const baseUrl = validateJellyfinUrl(options.baseUrl);
  async function session() {
    const secret = await credentials.read(options.credential);
    let api: Api | undefined;
    try {
      const credential = credentialSchema.parse(JSON.parse(Buffer.from(secret).toString('utf8')));
      api = apiFor(baseUrl, options.credential.id);
      const server = await serverInfo(api);
      noSecretEcho(server, [credential.token]);
      if (server.id !== credential.serverId) throw new ConnectorError('identity_mismatch');
      api.update({ accessToken: credential.token });
      return {
        api,
        credential,
        close() {
          secret.fill(0);
          api?.update({ accessToken: '' });
        },
      };
    } catch (error) {
      secret.fill(0);
      api?.update({ accessToken: '' });
      throw normalized(error);
    }
  }
  async function withCredential<T>(
    action: (api: Api, credential: z.infer<typeof credentialSchema>) => Promise<T>,
  ): Promise<T> {
    const active = await session();
    try {
      return await action(active.api, active.credential);
    } catch (error) {
      throw normalized(error);
    } finally {
      active.close();
    }
  }
  const connector: ManagedMediaConnector = {
    async connect() {
      await withCredential(async (api, credential) => {
        const user = userSchema.parse((await getUserApi(api).getCurrentUser()).data);
        if (user.Id !== credential.userId) throw new ConnectorError('identity_mismatch');
      });
    },
    async getServerInfo() {
      return withCredential(async (_api, credential) => {
        const info = await serverInfo(apiFor(baseUrl, options.credential.id));
        noSecretEcho(info, [credential.token]);
        return info;
      });
    },
    async testConnection(): Promise<ConnectionResult> {
      try {
        await connector.connect();
        return { ok: true, serverName: (await connector.getServerInfo()).name };
      } catch (error) {
        const safe = normalized(error);
        return { ok: false, code: safe.code, message: safe.message };
      }
    },
    async getLibraries() {
      return withCredential(async (api, credential) => {
        const available = await libraries(api, credential.userId);
        noSecretEcho(available, [credential.token]);
        return available;
      });
    },
    async disconnect() {
      await withCredential(async (api) => {
        try {
          await getSessionApi(api).reportSessionEnded();
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 401) return;
          throw error;
        }
      });
    },
    async *scanCatalog(libraryId, scanOptions = {}) {
      if (!identifier.safeParse(libraryId).success)
        throw new ConnectorError('invalid_configuration');
      const limit = scanOptions.pageSize ?? 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new ConnectorError('invalid_configuration');
      const active = await session();
      try {
        let offset = 0,
          total: number | undefined;
        for (let pages = 0; pages < 10000; pages++) {
          scanOptions.signal?.throwIfAborted();
          const page = pageSchema.parse(
            (
              await catalogApi(active.api).getItems(
                {
                  userId: active.credential.userId,
                  parentId: libraryId,
                  recursive: true,
                  startIndex: offset,
                  limit,
                  sortBy: ['SortName'],
                  sortOrder: ['Ascending'],
                  fields: ['ParentId', 'SortName', 'ProviderIds', 'Etag', 'DateCreated'],
                  enableImages: false,
                  enableUserData: false,
                  enableTotalRecordCount: true,
                },
                scanOptions.signal ? { signal: scanOptions.signal } : {},
              )
            ).data,
          );
          if (
            page.StartIndex !== offset ||
            page.Items.length > limit ||
            (total !== undefined && total !== page.TotalRecordCount) ||
            offset + page.Items.length > page.TotalRecordCount ||
            (page.Items.length === 0 && offset !== page.TotalRecordCount) ||
            new Set(page.Items.map((item) => item.Id)).size !== page.Items.length
          )
            throw new ConnectorError('invalid_response');
          total = page.TotalRecordCount;
          const items = page.Items.map((item) => normalizeItem(item, libraryId));
          noSecretEcho(items, [active.credential.token]);
          yield items;
          offset += items.length;
          if (offset === total) return;
        }
        throw new ConnectorError('invalid_response');
      } catch (error) {
        throw normalized(error);
      } finally {
        active.close();
      }
    },
    async getItem(id): Promise<MediaItem> {
      if (!identifier.safeParse(id).success) throw new ConnectorError('invalid_configuration');
      return withCredential(async (api, credential) => {
        const item = normalizeItem(
          (await catalogApi(api).getItem({ itemId: id, userId: credential.userId })).data,
        );
        if (item.id !== id) throw new ConnectorError('invalid_response');
        noSecretEcho(item, [credential.token]);
        return item;
      });
    },
    async search(): Promise<MediaItem[]> {
      throw new ConnectorNotImplementedError();
    },
    async getPlaybackInfo(): Promise<PlaybackInfo> {
      throw new ConnectorNotImplementedError();
    },
    async reportPlaybackStart() {
      throw new ConnectorNotImplementedError();
    },
    async reportPlaybackProgress() {
      throw new ConnectorNotImplementedError();
    },
    async reportPlaybackStop() {
      throw new ConnectorNotImplementedError();
    },
  };
  return connector;
}

/** Best-effort rollback helper for a token issued before local persistence failed. */
export async function revokeJellyfinCredential(
  baseUrl: string,
  deviceId: string,
  secret: Uint8Array,
): Promise<void> {
  await createJellyfinConnector(
    { baseUrl, credential: { id: deviceId } },
    {
      async read() {
        return Uint8Array.from(secret);
      },
      async store() {
        throw new ConnectorError('unsupported');
      },
      async delete() {},
    },
  ).disconnect();
}
