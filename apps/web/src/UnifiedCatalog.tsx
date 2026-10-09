import { useEffect, useState } from 'react';
import type { CatalogItem, CatalogWork, WorkPage, WorkSourcePage } from '@openflix/shared';
import { mediaTypes } from '@openflix/shared';
import { Player } from './Player.js';
async function read<T>(path: string): Promise<T> {
  const response = await fetch('/api/v1/catalog' + path, { credentials: 'same-origin' });
  if (!response.ok)
    throw new Error('Could not load the unified catalog. Check your login and refresh.');
  return response.json() as Promise<T>;
}
export function UnifiedCatalog({ admin }: { admin: boolean }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<WorkPage | null>(null);
  const [offset, setOffset] = useState(0),
    [type, setType] = useState(''),
    [source, setSource] = useState('');
  const [series, setSeries] = useState(''),
    [season, setSeason] = useState('');
  const [detail, setDetail] = useState<{ work: CatalogWork; sources: WorkSourcePage } | null>(null);
  const [sourceOffset, setSourceOffset] = useState(0);
  const [selected, setSelected] = useState(''),
    [playing, setPlaying] = useState<CatalogItem | null>(null);
  const [error, setError] = useState('');
  const [labels, setLabels] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    read<{ libraries: { connectorId: string; connectorName: string }[] }>('/libraries')
      .then((v) => {
        if (active)
          setLabels([
            ...new Map(
              v.libraries.map((l) => [l.connectorId, { id: l.connectorId, name: l.connectorName }]),
            ).values(),
          ]);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const q = new URLSearchParams({ offset: String(offset), limit: '24' });
    if (type) q.set('type', type);
    if (source) q.set('connectorId', source);
    if (series) q.set('seriesWorkId', series);
    if (season) q.set('seasonNumber', season);
    setError('');
    read<WorkPage>('/works?' + q)
      .then((v) => {
        if (active) setPage(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [open, offset, type, source, series, season]);
  useEffect(() => {
    if (!detail) return;
    let active = true;
    read<{ work: CatalogWork; sources: WorkSourcePage }>(
      '/works/' + detail.work.id + '?offset=' + sourceOffset + '&limit=24',
    )
      .then((v) => {
        if (active) setDetail(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [detail?.work.id, sourceOffset]);
  function back() {
    setPlaying(null);
    setDetail(null);
    setSelected('');
    setSourceOffset(0);
  }
  async function show(work: CatalogWork) {
    back();
    setError('');
    try {
      setDetail(await read('/works/' + work.id + '?limit=24'));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function prepare() {
    if (!detail) return;
    setError('');
    try {
      const id = selected || detail.work.representativeItemId;
      setPlaying((await read<{ item: CatalogItem }>('/items/' + id)).item);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section aria-label="Unified catalog">
      <button
        className="secondary"
        onClick={() => {
          setOpen(!open);
          back();
        }}
      >
        Unified catalog
      </button>
      {open && (
        <>
          <h2>All servers</h2>
          <p>
            Source counts describe last-indexed backend items, not current availability. Duplicate
            connections to one backend do not imply additional copies.
          </p>
          {error && <p role="alert">{error}</p>}
          {detail ? (
            <>
              <button onClick={back}>Back to unified catalog</button>
              <h3>{detail.work.title}</h3>
              <p>
                {detail.work.sourceCount} indexed sources · {detail.work.connectionCount}{' '}
                connections
              </p>
              {detail.work.type === 'series' && (
                <button
                  onClick={() => {
                    setSeries(detail.work.id);
                    setType('episode');
                    setOffset(0);
                    back();
                  }}
                >
                  Browse episodes
                </button>
              )}
              <label>
                Source/version
                <select
                  value={selected}
                  disabled={!!playing}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Automatic (equivalent editions only)</option>
                  {detail.sources.items.map((s) => (
                    <option key={s.itemId} value={s.itemId}>
                      {s.connectorName} · {s.edition ?? 'Edition unspecified'} ·{' '}
                      {s.versionLabels.join(', ') || s.title}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Different or unspecified editions require an explicit source choice. Multiple
                upstream versions within one source are not selected automatically.
              </p>
              <button
                disabled={!!playing || sourceOffset === 0}
                onClick={() => setSourceOffset(Math.max(0, sourceOffset - 24))}
              >
                Previous sources
              </button>
              <button
                disabled={!!playing || sourceOffset + 24 >= detail.sources.total}
                onClick={() => setSourceOffset(sourceOffset + 24)}
              >
                More sources
              </button>
              {admin && ['movie', 'episode', 'audio'].includes(detail.work.type) && !playing && (
                <button onClick={() => void prepare()}>Open player</button>
              )}
              {!admin && <p>Playback is restricted to administrators.</p>}
              {playing && (
                <>
                  <Player
                    key={detail.work.id + selected}
                    item={playing}
                    groupId={detail.work.id}
                    {...(selected ? { sourceItemId: selected } : {})}
                  />
                  <button onClick={() => setPlaying(null)}>
                    Close player / choose another source
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <label>
                Media type
                <select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">All types</option>
                  {mediaTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Server
                <select
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">All servers</option>
                  {labels.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              {series && (
                <>
                  <label>
                    Season number
                    <input
                      type="number"
                      min="0"
                      max="999999"
                      value={season}
                      onChange={(e) => {
                        setSeason(e.target.value);
                        setOffset(0);
                      }}
                    />
                  </label>
                  <button
                    onClick={() => {
                      setSeries('');
                      setSeason('');
                      setOffset(0);
                    }}
                  >
                    All works
                  </button>
                </>
              )}
              <ul>
                {page?.items.map((w) => (
                  <li key={w.id}>
                    <button onClick={() => void show(w)}>{w.title}</button> · {w.type} ·{' '}
                    {w.sourceCount} indexed sources
                  </li>
                ))}
              </ul>
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 24))}>
                Previous works
              </button>
              <button
                disabled={!page || offset + 24 >= page.total}
                onClick={() => setOffset(offset + 24)}
              >
                More works
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
