import { ConnectorError } from '@openflix/connector-core';
import { createJellyfinConnector } from '@openflix/connector-jellyfin';
import type { OpenFlixDatabase } from '@openflix/database';
import type { AuthService } from './auth.js';
import type { EncryptedCredentialStore } from './connector-credentials.js';
/** Indexed metadata is not an authorization grant. Never cache permission decisions across requests. */
export function catalogPermissions(
  db: OpenFlixDatabase,
  auth: AuthService,
  vault: EncryptedCredentialStore | undefined,
  create = createJellyfinConnector,
) {
  let active = 0;
  const waiting: Array<{ grant: () => void }> = [];
  const acquire = (deadline: number): Promise<void> => {
    if (Date.now() >= deadline) return Promise.reject(new ConnectorError('timeout'));
    if (active < 12) {
      active++;
      return Promise.resolve();
    }
    if (waiting.length >= 64) return Promise.reject(new ConnectorError('busy'));
    return new Promise((resolve, reject) => {
      const entry = {
        grant: () => {
          clearTimeout(timer);
          active++;
          resolve();
        },
      };
      const timer = setTimeout(
        () => {
          const index = waiting.indexOf(entry);
          if (index >= 0) waiting.splice(index, 1);
          reject(new ConnectorError('timeout'));
        },
        Math.max(0, deadline - Date.now()),
      );
      waiting.push(entry);
    });
  };
  const release = () => {
    active--;
    waiting.shift()?.grant();
  };
  return async (token: string | undefined, value: Record<string, unknown>) => {
    const user = auth.currentUser(token);
    if (!user) throw new ConnectorError('cancelled');
    const scoped = db.forUser(user.id),
      ids = new Set<string>();
    const addWork = (id: string) => {
      const sources = scoped.works.sources(id, 0, 257);
      if (sources.total > 256) throw new ConnectorError('unavailable');
      for (const source of sources.items) ids.add(source.itemId);
    };
    if (value.work) addWork((value.work as { id: string }).id);
    if (Array.isArray(value.items))
      for (const item of value.items as { id: string; representativeItemId?: string }[]) {
        if (item.representativeItemId) addWork(item.id);
        else ids.add(item.id);
      }
    if (ids.size > 256) throw new ConnectorError('unavailable');
    const tasks: Array<() => Promise<void>> = [];
    const valid = () => {
      if (auth.currentUser(token)?.id !== user.id) throw new ConnectorError('cancelled');
    };
    if (Array.isArray(value.libraries)) {
      const indexed = value.libraries as { connectorId: string; upstreamId: string }[];
      for (const record of scoped.listConnectors())
        tasks.push(async () => {
          if (!vault) throw new ConnectorError('credential_unavailable');
          const libraries = await create(
            { baseUrl: record.baseUrl, credential: { id: record.id } },
            vault.forUser(user.id),
          ).getLibraries();
          if (
            indexed.some(
              (l) =>
                l.connectorId === record.id &&
                !libraries.some((current) => current.id === l.upstreamId),
            )
          )
            throw new ConnectorError('not_found');
          if (!scoped.getConnector(record.id)) throw new ConnectorError('not_found');
        });
    }
    if (Array.isArray(value.items) && ids.size === 0)
      for (const record of scoped.listConnectors())
        tasks.push(async () => {
          if (!vault) throw new ConnectorError('credential_unavailable');
          await create(
            { baseUrl: record.baseUrl, credential: { id: record.id } },
            vault.forUser(user.id),
          ).connect();
          if (!scoped.getConnector(record.id)) throw new ConnectorError('not_found');
        });
    for (const id of ids)
      tasks.push(async () => {
        const item = scoped.catalog.item(id),
          record = item && scoped.getConnector(item.connectorId);
        if (!item || !record) throw new ConnectorError('not_found');
        if (!vault) throw new ConnectorError('credential_unavailable');
        await create(
          { baseUrl: record.baseUrl, credential: { id: record.id } },
          vault.forUser(user.id),
        ).getItem(item.upstreamId);
        if (!scoped.catalog.item(id) || !scoped.getConnector(record.id))
          throw new ConnectorError('not_found');
      });
    const deadline = Date.now() + 8000;
    let next = 0,
      failed = false;
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(tasks.length, 4) }, async () => {
        try {
          for (;;) {
            valid();
            if (failed || Date.now() > deadline) throw new ConnectorError('cancelled');
            const task = tasks[next++];
            if (!task) return;
            await acquire(deadline);
            try {
              valid();
              if (failed || Date.now() >= deadline) throw new ConnectorError('cancelled');
              await task();
            } finally {
              release();
            }
            valid();
          }
        } catch (error) {
          failed = true;
          throw error;
        }
      }),
    );
    valid();
    const failure = results.find((r) => r.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  };
}
