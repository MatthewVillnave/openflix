import { useEffect, useState } from 'react';
import type {
  CatalogLibrary,
  CatalogPage,
  CatalogItem,
  CatalogSyncStatus,
  ConnectorSummary,
} from '@openflix/shared';
import { mediaTypes } from '@openflix/shared';
import { connectorRequest } from './api.js';
async function catalogRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/catalog${path}`, {
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok)
    throw new Error(
      response.status === 503
        ? 'Another operation is running or credentials are unavailable.'
        : 'Could not load the catalog. Check your session and try again.',
    );
  return response.json() as Promise<T>;
}
export function Catalog({ admin }: { admin: boolean }) {
  const [libraries, setLibraries] = useState<CatalogLibrary[]>([]);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [type, setType] = useState('');
  const [parent, setParent] = useState('');
  const [detail, setDetail] = useState<CatalogItem | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<CatalogSyncStatus | null>(null);
  const [poll, setPoll] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    catalogRequest<{ libraries: CatalogLibrary[] }>('/libraries')
      .then((v) => {
        if (active) setLibraries(v.libraries);
      })
      .catch(() => {
        if (active) setError('Could not load catalog libraries.');
      });
    if (admin)
      connectorRequest<{ connectors: ConnectorSummary[] }>()
        .then((v) => {
          if (active) setConnectors(v.connectors);
        })
        .catch(() => {
          if (active) setError('Could not load media servers.');
        });
    return () => {
      active = false;
    };
  }, [admin, revision]);
  useEffect(() => {
    if (!selected) {
      setPage(null);
      return;
    }
    let active = true;
    setPage(null);
    const query = new URLSearchParams({
      offset: String(offset),
      limit: '50',
      ...(type ? { type } : {}),
      ...(parent ? { parentId: parent } : {}),
    });
    catalogRequest<CatalogPage>(`/libraries/${encodeURIComponent(selected)}/items?${query}`)
      .then((v) => {
        if (active) setPage(v);
      })
      .catch(() => {
        if (active) setError('Could not load catalog entries.');
      });
    return () => {
      active = false;
    };
  }, [selected, offset, type, parent, revision]);
  useEffect(() => {
    if (!poll) return;
    let active = true;
    const timer = setInterval(() => {
      catalogRequest<CatalogSyncStatus>(`/sync/${encodeURIComponent(poll)}`)
        .then((v) => {
          if (!active) return;
          setStatus(v);
          if (v.state !== 'syncing') {
            setPoll('');
            setRevision((n) => n + 1);
          }
        })
        .catch(() => {
          if (active) {
            setPoll('');
            setError('Could not read synchronization status. Refresh to retry.');
          }
        });
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [poll]);
  async function synchronize(connectorId: string, libraryId?: string) {
    setError('');
    try {
      const result = await catalogRequest<CatalogSyncStatus>(
        `/sync/${encodeURIComponent(connectorId)}`,
        libraryId ? { libraryId } : {},
      );
      setStatus(result);
      setPoll(connectorId);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function showItem(id: string) {
    try {
      setDetail(
        (await catalogRequest<{ item: CatalogItem }>(`/items/${encodeURIComponent(id)}`)).item,
      );
    } catch {
      setError('Could not load this item.');
    }
  }
  return (
    <section aria-label="Catalog">
      <h2>Catalog</h2>
      <p>Browse synchronized metadata. Playback is not available.</p>
      <button
        onClick={() => {
          setRevision((n) => n + 1);
          setError('');
        }}
      >
        Refresh catalog
      </button>
      {admin && (
        <div>
          <h3>Synchronize media servers</h3>
          <p>
            Synchronized metadata is visible to all signed-in OpenFlix users. Choose the connector
            account accordingly.
          </p>
          {connectors.map((c) => (
            <div key={c.id}>
              <span>{c.name}</span>{' '}
              <button disabled={Boolean(poll)} onClick={() => void synchronize(c.id)}>
                Sync {c.name}
              </button>{' '}
              <button
                onClick={() => {
                  void catalogRequest<CatalogSyncStatus>(`/sync/${encodeURIComponent(c.id)}`)
                    .then((v) => {
                      setStatus(v);
                      if (v.state === 'syncing') setPoll(c.id);
                    })
                    .catch(() => setError('Could not read synchronization status.'));
                }}
              >
                Status for {c.name}
              </button>
            </div>
          ))}
        </div>
      )}
      {status && (
        <p role="status">
          Synchronization: {status.state}
          {status.error ? ` (${status.error})` : ''}.{' '}
          {status.lastSuccessfulAt
            ? `Last success: ${new Date(status.lastSuccessfulAt).toLocaleString()}`
            : ''}
        </p>
      )}
      {libraries.length === 0 ? (
        <p>No synchronized libraries yet. An administrator can start a sync.</p>
      ) : (
        <nav aria-label="Catalog libraries">
          {libraries.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                setSelected(l.id);
                setOffset(0);
                setType('');
                setParent('');
                setDetail(null);
              }}
            >
              {l.name} · {l.connectorName} ({l.type})
            </button>
          ))}
        </nav>
      )}
      {selected && (
        <div>
          <label>
            Media type{' '}
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All types</option>
              {mediaTypes
                .filter((t) => t !== 'music')
                .map((t) => (
                  <option key={t}>{t}</option>
                ))}
            </select>
          </label>
          {parent && (
            <button
              onClick={() => {
                setParent('');
                setOffset(0);
              }}
            >
              All library entries
            </button>
          )}
          {admin && libraries.find((l) => l.id === selected) && (
            <button
              disabled={Boolean(poll)}
              onClick={() =>
                void synchronize(libraries.find((l) => l.id === selected)!.connectorId, selected)
              }
            >
              Sync this library
            </button>
          )}
          {page && (
            <>
              <p>{page.total} entries</p>
              <ul>
                {page.items.map((item) => (
                  <li key={item.id}>
                    <button onClick={() => void showItem(item.id)}>{item.title}</button> ·{' '}
                    {item.type}
                    {item.year ? ` · ${item.year}` : ''}
                    {['series', 'season', 'album', 'artist'].includes(item.type) && (
                      <button
                        onClick={() => {
                          setParent(item.id);
                          setType('');
                          setOffset(0);
                        }}
                      >
                        Browse children of {item.title}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <button disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - 50))}>
                Previous page
              </button>
              <button
                disabled={offset + page.items.length >= page.total}
                onClick={() => setOffset((n) => n + 50)}
              >
                Next page
              </button>
            </>
          )}
        </div>
      )}
      {detail && (
        <article aria-label="Item details">
          <h3>{detail.title}</h3>
          <p>
            {detail.type} · Source{' '}
            {libraries.find((l) => l.connectorId === detail.connectorId)?.connectorName ??
              detail.connectorId}
          </p>
          <p>
            {detail.year ?? ''}{' '}
            {detail.runtimeSeconds !== undefined ? `${detail.runtimeSeconds} seconds` : ''}
          </p>
          {detail.seasonNumber !== undefined && <p>Season {detail.seasonNumber}</p>}
          {detail.episodeNumber !== undefined && <p>Episode {detail.episodeNumber}</p>}
          {detail.parentId && (
            <button onClick={() => void showItem(detail.parentId!)}>View parent</button>
          )}
          {detail.albumTitle && <p>Album: {detail.albumTitle}</p>}
          <button onClick={() => setDetail(null)}>Close details</button>
        </article>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
