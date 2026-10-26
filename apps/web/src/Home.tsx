import { LibraryLoad } from './LibraryLoad.js';
import { queueArtwork } from './artwork-queue.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CatalogItem,
  CatalogPage,
  CatalogWork,
  User,
  WorkPage,
  WorkSourcePage,
} from '@openflix/shared';
import { Catalog } from './Catalog.js';
import { BrowseMenu } from './BrowseMenu.js';
import { MediaServers } from './MediaServers.js';
import { LegalNotice } from './LegalNotice.js';
import { Player } from './Player.js';
import './home.css';

async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch('/api/v1/catalog' + path, { credentials: 'same-origin', signal });
    if (![502, 503, 504].includes(response.status) || attempt >= 2) break;
    // Only bounded transient GET retries; never retry authentication/permission failures.
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const stop = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(
        () => {
          signal.removeEventListener('abort', stop);
          resolve();
        },
        (attempt + 1) * 400,
      );
      signal.addEventListener('abort', stop, { once: true });
    });
  }
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Your session has expired. Sign in again.'
        : 'This part of your library is unavailable. Please try again.',
    );
  return response.json() as Promise<T>;
}
type View =
  | { kind: 'home' }
  | { kind: 'settings' }
  | { kind: 'browse'; type: 'movie' | 'series' }
  | { kind: 'detail'; id: string; work: boolean }
  | { kind: 'player'; item: CatalogItem; groupId?: string; sourceItemId?: string };
type Frame = { view: View; key: string; scroll: number; focus: string };
type Navigate = (view: View) => void;
export function Artwork({
  id,
  kind = 'poster',
  eager = false,
}: {
  id: string;
  kind?: 'poster' | 'backdrop';
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false),
    [ready, setReady] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const finish = useRef<() => void>(() => {});
  useEffect(() => {
    let cancel = () => {},
      timer: ReturnType<typeof setTimeout> | undefined;
    let requested = false;
    setFailed(false);
    setReady(false);
    const begin = () => {
      if (requested) return;
      requested = true;
      cancel = queueArtwork((release) => {
        finish.current = () => {
          clearTimeout(timer);
          release();
        };
        timer = setTimeout(() => {
          setFailed(true);
          release();
        }, 10000);
        setReady(true);
      });
    };
    const observer =
      !eager && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                begin();
                observer?.disconnect();
              }
            },
            { rootMargin: '120px' },
          )
        : null;
    if (observer && container.current) observer.observe(container.current);
    else begin();
    return () => {
      observer?.disconnect();
      clearTimeout(timer);
      cancel();
      finish.current = () => {};
    };
  }, [id, kind, eager]);
  return (
    <div
      ref={container}
      className={`artwork artwork-${kind}${failed ? ' artwork-missing' : ''}`}
      aria-hidden="true"
    >
      <span className="artwork-fallback">
        O<span>F</span>
      </span>
      {ready && !failed && (
        <img
          src={`/api/v1/catalog/items/${encodeURIComponent(id)}/artwork/${kind}`}
          alt=""
          onLoad={() => finish.current()}
          onError={() => {
            setFailed(true);
            finish.current();
          }}
        />
      )}
    </div>
  );
}

function Metadata({ item }: { item: { type: string; year?: number; runtimeSeconds?: number } }) {
  return (
    <p className="media-meta">
      <span>
        {item.type === 'series'
          ? 'Series'
          : item.type === 'episode'
            ? 'Episode'
            : item.type === 'season'
              ? 'Season'
              : 'Movie'}
      </span>
      {item.year && <span>{item.year}</span>}
      {item.runtimeSeconds !== undefined && <span>{Math.round(item.runtimeSeconds / 60)} min</span>}
    </p>
  );
}
function Shelf({
  grid = false,
  active,
  revision,
  type,
  onNavigate,
  onFeature,
}: {
  grid?: boolean;
  active: boolean;
  revision: number;
  type: 'movie' | 'series';
  onNavigate: Navigate;
  onFeature?: (items: CatalogWork[]) => void;
}) {
  const [offset, setOffset] = useState(0),
    [retry, setRetry] = useState(0);
  const [page, setPage] = useState<WorkPage | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    if (!active) return;
    setError('');
    setPage(null);
    void read<WorkPage>(`/works?type=${type}&offset=${offset}&limit=24`, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        if (offset > 0 && offset >= value.total) {
          setOffset(value.total ? Math.floor((value.total - 1) / 24) * 24 : 0);
          return;
        }
        setPage(value);
        if (offset === 0) onFeature?.(value.items.slice(0, 8));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [offset, retry, type, active, revision]);
  return (
    <section
      className="shelf"
      aria-label={type === 'movie' ? 'Movies' : grid ? 'TV Shows' : 'Series'}
    >
      <div className={grid ? 'sr-only' : 'shelf-heading'}>
        <h2>{type === 'movie' ? 'Movies' : 'Series'}</h2>
      </div>
      {error ? (
        <div role="alert">
          {error}
          <button onClick={() => setRetry((n) => n + 1)}>
            Retry {type === 'movie' ? 'movies' : 'series'}
          </button>
        </div>
      ) : !page ? (
        <p role="status">Loading {type === 'movie' ? 'movies' : 'series'}…</p>
      ) : page.items.length ? (
        <>
          <div className={grid ? 'poster-grid' : 'poster-row'}>
            {page.items.map((item) => (
              <button
                className="poster-card"
                key={item.id}
                data-focus={`poster-${item.id}`}
                onClick={() => onNavigate({ kind: 'detail', id: item.id, work: true })}
              >
                <Artwork id={item.representativeItemId} />
                <strong>{item.title}</strong>
                <span>{item.year ?? (type === 'series' ? 'Series' : 'Movie')}</span>
              </button>
            ))}
          </div>
          <div className="shelf-pages" hidden={page.total <= 24}>
            <button disabled={!offset} onClick={() => setOffset((n) => Math.max(0, n - 24))}>
              Previous {type === 'movie' ? 'movies' : 'series'}
            </button>
            <span>
              {offset + 1}–{offset + page.items.length} of {page.total}
            </span>
            <button
              disabled={offset + page.items.length >= page.total}
              onClick={() => setOffset((n) => n + 24)}
            >
              More {type === 'movie' ? 'movies' : 'series'}
            </button>
          </div>
        </>
      ) : (
        <p className="empty-library">
          No {type === 'movie' ? 'movies' : 'series'} indexed yet. Connect a server in Settings; its
          accessible libraries load automatically.
        </p>
      )}
    </section>
  );
}
export function FeaturedHero({
  items,
  active,
  onNavigate,
}: {
  items: CatalogWork[];
  active: boolean;
  onNavigate: Navigate;
}) {
  const hero = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(true);
  const [selected, setSelected] = useState('');
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [hidden, setHidden] = useState(() => document.hidden);
  const feature = items.find((item) => item.id === selected) ?? items[0];
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !hero.current) return;
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry?.isIntersecting ?? false),
    );
    observer.observe(hero.current);
    return () => observer.disconnect();
  }, []);
  const pauseReason =
    !active || hidden ? 'hidden' : !inView ? 'offscreen' : items.length < 2 ? 'single-item' : '';
  useEffect(() => {
    if (pauseReason) return;
    const timer = window.setTimeout(() => {
      const index = items.findIndex((item) => item.id === feature?.id);
      setSelected(items[(index + 1) % items.length]!.id);
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [pauseReason, items, feature?.id, selectionRevision]);
  const select = (direction: number) => {
    const index = items.findIndex((item) => item.id === feature?.id);
    setSelected(items[(index + direction + items.length) % items.length]!.id);
    setSelectionRevision((value) => value + 1);
  };
  return (
    <section
      ref={hero}
      className="hero"
      aria-label="Featured from your library"
      aria-roledescription="carousel"
      data-rotation-state={pauseReason || 'playing'}
    >
      {feature && (
        <Artwork
          key={`${feature.id}:${feature.representativeItemId}`}
          id={feature.representativeItemId}
          kind="backdrop"
          eager
        />
      )}
      <div className="hero-content">
        <h1 tabIndex={-1} data-heading>
          {feature?.title ?? 'Make room for what you love.'}
        </h1>
        {feature ? (
          <>
            <Metadata item={feature} />
            <p className="synopsis">{feature.overview || 'No description available.'}</p>
            <button
              className="primary-action"
              data-focus="hero-details"
              onClick={() => onNavigate({ kind: 'detail', id: feature.id, work: true })}
            >
              Explore title <span aria-hidden="true">↗</span>
            </button>
          </>
        ) : (
          <p className="synopsis">
            Your collection, together. Browse movies and series from your connected servers.
          </p>
        )}
      </div>
      {items.length > 1 && (
        <div className="hero-controls" aria-label="Featured title controls">
          <button aria-label="Previous featured title" onClick={() => select(-1)}>
            ‹
          </button>
          <div className="hero-indicators" aria-label="Featured titles">
            {items.map((item, i) => (
              <button
                key={item.id}
                aria-label={`Show featured title ${i + 1} of ${items.length}`}
                title={item.title}
                aria-pressed={feature?.id === item.id}
                onClick={() => {
                  setSelected(item.id);
                  setSelectionRevision((value) => value + 1);
                }}
              >
                <span />
              </button>
            ))}
          </div>
          <button aria-label="Next featured title" onClick={() => select(1)}>
            ›
          </button>
        </div>
      )}
    </section>
  );
}
function Home({
  onNavigate,
  active,
  revision,
}: {
  onNavigate: Navigate;
  active: boolean;
  revision: number;
}) {
  const [movieFeature, setMovieFeature] = useState<CatalogWork[]>([]);
  const [seriesFeature, setSeriesFeature] = useState<CatalogWork[]>([]);
  const featured = useMemo(() => {
    const result: CatalogWork[] = [];
    for (let i = 0; i < 8 && result.length < 8; i++) {
      if (movieFeature[i]) result.push(movieFeature[i]!);
      if (seriesFeature[i] && result.length < 8) result.push(seriesFeature[i]!);
    }
    return result;
  }, [movieFeature, seriesFeature]);
  return (
    <>
      <FeaturedHero items={featured} active={active} onNavigate={onNavigate} />
      <div className="home-shelves">
        <Shelf
          active={active}
          revision={revision}
          type="movie"
          onNavigate={onNavigate}
          onFeature={setMovieFeature}
        />
        <Shelf
          active={active}
          revision={revision}
          type="series"
          onNavigate={onNavigate}
          onFeature={setSeriesFeature}
        />
      </div>
    </>
  );
}
function Detail({
  view,
  admin,
  active,
  revision,
  onNavigate,
}: {
  view: Extract<View, { kind: 'detail' }>;
  admin: boolean;
  active: boolean;
  revision: number;
  onNavigate: Navigate;
}) {
  const [detail, setDetail] = useState<{ work: CatalogWork; sources: WorkSourcePage } | null>(null);
  const [item, setItem] = useState<CatalogItem | null>(null),
    [selected, setSelected] = useState('');
  const [sourceOffset, setSourceOffset] = useState(0),
    [childOffset, setChildOffset] = useState(0);
  const [children, setChildren] = useState<CatalogPage | null>(null),
    [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    if (item && article.current && !article.current.closest('[hidden]'))
      article.current.querySelector<HTMLElement>('[data-heading]')?.focus({ preventScroll: true });
  }, [item?.id]);
  useEffect(() => {
    const controller = new AbortController();
    if (!active) return;
    setError('');
    setItem(null);
    setDetail(null);
    setChildren(null);
    void (async () => {
      const value = view.work
        ? await read<{ work: CatalogWork; sources: WorkSourcePage }>(
            `/works/${view.id}?offset=${sourceOffset}&limit=24`,
            controller.signal,
          )
        : null;
      const id = selected || value?.work.representativeItemId || view.id;
      const result = await read<{ item: CatalogItem }>(`/items/${id}`, controller.signal);
      if (!controller.signal.aborted) {
        setDetail(value);
        setItem(result.item);
      }
    })().catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [view.id, view.work, selected, sourceOffset, retry, active, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setChildren(null);
    if (item && ['series', 'season'].includes(item.type) && item.libraryIds[0]) {
      void read<CatalogPage>(
        `/libraries/${item.libraryIds[0]}/items?parentId=${item.id}&limit=50&offset=${childOffset}`,
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted) setChildren(value);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    }
    return () => controller.abort();
  }, [item, childOffset]);
  if (error)
    return (
      <div className="view-message" role="alert">
        {error}
        <button onClick={() => setRetry((n) => n + 1)}>Try again</button>
      </div>
    );
  if (!item)
    return (
      <p className="view-message" role="status">
        Loading details…
      </p>
    );
  return (
    <article ref={article} className="title-detail" aria-label="Title details">
      <section className="hero detail-hero">
        <Artwork key={item.id} id={item.id} kind="backdrop" eager />
        <div className="hero-content">
          <h1 tabIndex={-1} data-heading>
            {item.title}
          </h1>
          <Metadata item={item} />
          {item.seasonNumber !== undefined && (
            <p className="media-meta">
              Season {item.seasonNumber}
              {item.episodeNumber !== undefined ? ` · Episode ${item.episodeNumber}` : ''}
            </p>
          )}
          <p className="synopsis">
            {item.overview || 'No description is available for this title yet.'}
          </p>
          {item.genres?.length ? <p className="genres">{item.genres.join(' · ')}</p> : null}
          {['movie', 'episode'].includes(item.type) &&
            (admin ? (
              <button
                className="primary-action"
                data-focus="open-player"
                onClick={() =>
                  onNavigate({
                    kind: 'player',
                    item,
                    ...(detail
                      ? {
                          groupId: detail.work.id,
                          ...(selected || detail.sources.total === 1
                            ? { sourceItemId: selected || item.id }
                            : {}),
                        }
                      : {}),
                  })
                }
              >
                Watch <span aria-hidden="true">▶</span>
              </button>
            ) : (
              <p>Playback requires your linked server permission.</p>
            ))}
        </div>
      </section>
      <div className="detail-body">
        {detail && detail.sources.total > 1 && (
          <details className="source-panel" aria-label="Playback source">
            <summary>Versions &amp; sources</summary>
            <h2 className="sr-only">Your sources</h2>
            <span className="source-count">{detail.work.sourceCount} sources</span>
            <label htmlFor={`source-${view.id}`}>Source/version</label>
            <select
              id={`source-${view.id}`}
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setChildOffset(0);
              }}
            >
              <option value="">
                {item.type === 'series'
                  ? 'Default library source'
                  : 'Automatic (equivalent editions only)'}
              </option>
              {selected && !detail.sources.items.some((s) => s.itemId === selected) && (
                <option value={selected}>Selected source</option>
              )}
              {detail.sources.items.map((s) => (
                <option key={s.itemId} value={s.itemId}>
                  {s.connectorName} · {s.edition ?? 'Edition unspecified'} ·{' '}
                  {s.versionLabels.join(', ') || s.title}
                </option>
              ))}
            </select>
            <details className="source-help">
              <summary>About source selection</summary>
              <p>
                Availability is checked when playback starts. Different or unspecified editions
                require an explicit source choice. Series seasons and episodes follow the selected
                library source.
              </p>
            </details>
            {detail.sources.total > 24 && (
              <div className="shelf-pages">
                <button
                  disabled={!sourceOffset}
                  onClick={() => setSourceOffset((n) => Math.max(0, n - 24))}
                >
                  Previous sources
                </button>
                <button
                  disabled={sourceOffset + 24 >= detail.sources.total}
                  onClick={() => setSourceOffset((n) => n + 24)}
                >
                  More sources
                </button>
              </div>
            )}
          </details>
        )}
        {['series', 'season'].includes(item.type) && (
          <section aria-label="Seasons and episodes">
            <h2>{item.type === 'series' ? 'Seasons & episodes' : 'Episodes'}</h2>
            {!children ? (
              <p role="status">Loading episodes…</p>
            ) : !children.items.length ? (
              <p>No seasons or episodes indexed here. Browse can refresh the catalog.</p>
            ) : (
              <>
                <div className="episode-grid">
                  {[...children.items]
                    .sort(
                      (a, b) =>
                        (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) ||
                        (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0),
                    )
                    .map((child) => (
                      <button
                        className="episode-card"
                        key={child.id}
                        data-focus={`child-${child.id}`}
                        onClick={() => onNavigate({ kind: 'detail', id: child.id, work: false })}
                      >
                        <Artwork id={child.id} />
                        <span>
                          <small>
                            {child.type === 'season'
                              ? `Season ${child.seasonNumber ?? ''}`
                              : `Episode ${child.episodeNumber ?? ''}`}
                          </small>
                          <strong>{child.title}</strong>
                        </span>
                        <span aria-hidden="true">↗</span>
                      </button>
                    ))}
                </div>
                <div className="shelf-pages">
                  <button
                    disabled={!childOffset}
                    onClick={() => setChildOffset((n) => Math.max(0, n - 50))}
                  >
                    Previous entries
                  </button>
                  <button
                    disabled={childOffset + children.items.length >= children.total}
                    onClick={() => setChildOffset((n) => n + 50)}
                  >
                    More entries
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </article>
  );
}
export function Cinema({
  user,
  pending,
  error,
  onSignOut,
}: {
  user: User;
  pending: boolean;
  error: string;
  onSignOut: () => void;
}) {
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const catalogReady = useCallback(() => setCatalogRevision((n) => n + 1), []);
  const connectionChanged = useCallback(() => {
    setConnectionRevision((n) => n + 1);
    setCatalogRevision((n) => n + 1);
  }, []);
  const session = useRef(crypto.randomUUID());
  const frames = useRef<Frame[]>([{ view: { kind: 'home' }, key: 'home', scroll: 0, focus: '' }]);
  const [index, setIndex] = useState(0);
  const position = useRef(0);
  const save = () => {
    const frame = frames.current[position.current];
    if (frame) {
      frame.scroll = window.scrollY;
      frame.focus = (document.activeElement as HTMLElement)?.dataset.focus ?? '';
    }
  };
  useEffect(() => {
    window.history.replaceState({ openflix: session.current, index: 0 }, '');
    const pop = (event: PopStateEvent) => {
      save();
      const next =
        event.state?.openflix === session.current &&
        Number.isInteger(event.state.index) &&
        frames.current[event.state.index]
          ? (event.state.index as number)
          : 0;
      position.current = next;
      setIndex(next);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    const frame = frames.current[index]!;
    let observer: MutationObserver | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      observer?.disconnect();
    };
    document.addEventListener('pointerdown', stop, true);
    document.addEventListener('keydown', stop, true);
    const timer = window.setTimeout(() => {
      window.scrollTo(0, frame.scroll);
      const scope = document.getElementById('frame-' + frame.key);
      const restore = () => {
        if (stopped) return;
        const target = frame.focus
          ? Array.from(scope?.querySelectorAll<HTMLElement>('[data-focus]') ?? []).find(
              (node) => node.dataset.focus === frame.focus,
            )
          : scope?.querySelector<HTMLElement>('[data-heading]');
        if (
          target &&
          (document.activeElement === document.body || document.activeElement === target)
        )
          target.focus({ preventScroll: true });
      };
      restore();
      if (scope && frame.focus && !stopped) {
        observer = new MutationObserver(restore);
        observer.observe(scope, { childList: true, subtree: true });
      }
    }, 0);
    const expiry = window.setTimeout(stop, 5000);
    return () => {
      clearTimeout(timer);
      clearTimeout(expiry);
      document.removeEventListener('pointerdown', stop, true);
      document.removeEventListener('keydown', stop, true);
      stop();
    };
  }, [index]);
  const navigate: Navigate = (view) => {
    if (view.kind === 'browse' || view.kind === 'settings') {
      const existing = frames.current
        .slice(0, position.current + 1)
        .findIndex(
          (frame) =>
            frame.view.kind === view.kind &&
            (view.kind !== 'browse' ||
              (frame.view.kind === 'browse' && frame.view.type === view.type)),
        );
      if (existing >= 0) {
        if (existing !== position.current) window.history.go(existing - position.current);
        return;
      }
    }
    save();
    frames.current = frames.current.slice(0, position.current + 1);
    frames.current.push({ view, key: crypto.randomUUID(), scroll: 0, focus: '' });
    position.current++;
    window.history.pushState({ openflix: session.current, index: position.current }, '');
    setIndex(position.current);
  };
  return (
    <div className="cinema">
      <header className="cinema-header">
        <a
          className="wordmark"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            if (index) window.history.go(-index);
          }}
        >
          <span className="mark" aria-hidden="true">
            ▶
          </span>{' '}
          OPENFLIX
        </a>
        <nav aria-label="Main navigation">
          <button
            aria-current={index === 0 ? 'page' : undefined}
            onClick={() => {
              if (index) window.history.go(-index);
            }}
          >
            Home
          </button>
          <BrowseMenu onSelect={(type) => navigate({ kind: 'browse', type })} />
          {<button onClick={() => navigate({ kind: 'settings' })}>Settings</button>}
        </nav>
        <button
          className="account-button"
          aria-label={pending ? 'Signing out…' : 'Sign out'}
          disabled={pending}
          onClick={onSignOut}
        >
          {pending ? 'Signing out…' : 'Sign out'}
        </button>
      </header>
      <main className="cinema-main">
        <LibraryLoad revision={connectionRevision} onReady={catalogReady} />
        <h2 className="account-greeting sr-only">Welcome, {user.displayName}.</h2>
        {error && <p role="alert">{error}</p>}
        {index > 0 && (
          <button className="back-button" onClick={() => window.history.back()}>
            ← Back
          </button>
        )}
        {frames.current.slice(0, index + 1).map((frame, i) => (
          <div id={'frame-' + frame.key} key={frame.key} hidden={index !== i}>
            {frame.view.kind === 'home' ? (
              <Home onNavigate={navigate} active={index === i} revision={catalogRevision} />
            ) : frame.view.kind === 'detail' ? (
              <Detail
                view={frame.view}
                admin={true}
                active={index === i}
                revision={catalogRevision}
                onNavigate={navigate}
              />
            ) : frame.view.kind === 'player' ? (
              index === i && (
                <section className="player-view">
                  <h1 className="sr-only" data-heading tabIndex={-1}>
                    {frame.view.item.title}
                  </h1>
                  <Player
                    item={frame.view.item}
                    {...(frame.view.groupId ? { groupId: frame.view.groupId } : {})}
                    {...(frame.view.sourceItemId ? { sourceItemId: frame.view.sourceItemId } : {})}
                  />
                </section>
              )
            ) : frame.view.kind === 'settings' ? (
              <div className="utility-view">
                <MediaServers onChanged={connectionChanged} />
                <Catalog admin={true} maintenanceOnly />
              </div>
            ) : (
              <div className="utility-view">
                <h1 data-heading tabIndex={-1}>
                  {frame.view.type === 'movie' ? 'Movies' : 'TV Shows'}
                </h1>
                <Shelf
                  grid
                  type={frame.view.type}
                  active={index === i}
                  revision={catalogRevision}
                  onNavigate={navigate}
                />
              </div>
            )}
          </div>
        ))}
      </main>
      <footer className="cinema-footer">
        <span>Independent by design.</span>
        <LegalNotice />
      </footer>
    </div>
  );
}
