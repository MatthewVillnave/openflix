// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Cinema } from '../apps/web/src/Home.js';
vi.mock('../apps/web/src/Player.js', () => ({
  Player: ({
    item,
    groupId,
    sourceItemId,
  }: {
    item: { id: string };
    groupId?: string;
    sourceItemId?: string;
  }) => (
    <p>
      Existing player {item.id} {groupId} {sourceItemId ?? 'automatic'}
    </p>
  ),
}));
const user = { id: 'one', username: 'alice', displayName: 'Alice', role: 'admin' as const };
const movie = {
  id: 'work_movie',
  type: 'movie',
  title: 'A quiet horizon',
  representativeItemId: 'movie',
  sourceCount: 2,
  connectionCount: 2,
  memberCount: 2,
  overview: '<script>Plain synopsis</script>',
  year: 2026,
};
const series = {
  ...movie,
  id: 'work_series',
  type: 'series',
  title: 'The long way',
  representativeItemId: 'series',
};
const items = {
  movie: {
    id: 'movie',
    title: movie.title,
    type: 'movie',
    libraryIds: ['lib'],
    overview: movie.overview,
  },
  second: { id: 'second', title: movie.title, type: 'movie', libraryIds: ['lib'] },
  series: { id: 'series', title: series.title, type: 'series', libraryIds: ['lib'] },
  season: {
    id: 'season',
    title: 'Season One',
    type: 'season',
    seasonNumber: 1,
    libraryIds: ['lib'],
  },
  episode: {
    id: 'episode',
    title: 'First light',
    type: 'episode',
    seasonNumber: 1,
    episodeNumber: 1,
    libraryIds: ['lib'],
  },
};
function setup(options: { empty?: boolean; error?: boolean; single?: boolean } = {}) {
  const fetcher = vi.fn(async (path: string) => {
    let value: unknown;
    if (path === '/api/v1/connectors')
      value = { connectors: [], credentialStorageConfigured: true };
    else if (path.endsWith('/libraries')) value = { libraries: [] };
    else if (path.includes('/works?'))
      value = {
        items: options.empty ? [] : [path.includes('type=series') ? series : movie],
        total: options.empty ? 0 : 1,
      };
    else if (path.includes('/works/')) {
      const work = path.includes('work_series') ? series : movie;
      value = {
        work,
        sources: {
          items: [
            {
              itemId: work.representativeItemId,
              connectorName: 'Server A',
              edition: 'Original',
              versionLabels: [],
            },
            ...(!options.single && work.type === 'movie'
              ? [
                  {
                    itemId: 'second',
                    connectorName: 'Server B',
                    edition: 'Extended',
                    versionLabels: [],
                  },
                ]
              : []),
          ],
          total: options.single || work.type === 'series' ? 1 : 2,
        },
      };
    } else if (path.includes('/libraries/lib/items'))
      value = {
        items: [path.includes('parentId=series') ? items.season : items.episode],
        total: 1,
      };
    else value = { item: items[path.split('/').at(-1) as keyof typeof items] };
    return { ok: !options.error, status: options.error ? 503 : 200, json: async () => value };
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
const mount = (admin = true) =>
  render(
    <Cinema
      user={{ ...user, role: admin ? 'admin' : 'user' }}
      pending={false}
      error=""
      onSignOut={() => {}}
    />,
  );
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function back() {
  fireEvent.click(screen.getByRole('button', { name: '← Back' }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it('shows loading, empty and retryable errors without invented watch progress', async () => {
  setup({ empty: true });
  const view = mount();
  expect(screen.getByText('Loading movies…')).toBeTruthy();
  expect(await screen.findByText(/No movies indexed yet/)).toBeTruthy();
  expect(screen.queryByText(/Continue Watching/)).toBeNull();
  view.unmount();
  setup({ error: true });
  mount();
  expect(
    await screen.findByRole('button', { name: 'Retry movies' }, { timeout: 2500 }),
  ).toBeTruthy();
});
it('opens details, preserves explicit source selection across player Back, and restores poster focus', async () => {
  const fetcher = setup();
  mount();
  const card = await screen.findByRole('button', { name: /A quiet horizon/ });
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(740);
  card.focus();
  fireEvent.click(card);
  await screen.findByRole('heading', { name: movie.title });
  expect(document.querySelector('script')).toBeNull();
  fireEvent.change(screen.getByLabelText('Source/version'), { target: { value: 'second' } });
  await screen.findByRole('button', { name: 'Watch' });
  fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
  expect(await screen.findByText('Existing player second work_movie second')).toBeTruthy();
  await back();
  expect((screen.getByLabelText('Source/version') as HTMLSelectElement).value).toBe('second');
  await back();
  await waitFor(() => expect(document.activeElement).toBe(card));
  expect(window.scrollTo).toHaveBeenLastCalledWith(0, 740);
  expect(
    fetcher.mock.calls.every(
      ([path]) => path.startsWith('/api/v1/catalog/') || path === '/api/v1/connectors',
    ),
  ).toBe(true);
});
it('navigates series, seasons and episodes with one-level Back and personal playback', async () => {
  setup();
  mount(false);
  fireEvent.click(await screen.findByRole('button', { name: /The long way/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Season One/ }));
  fireEvent.click(await screen.findByRole('button', { name: /First light/ }));
  await screen.findByRole('heading', { name: 'First light' });
  expect(screen.queryByText('Playback is restricted to administrators.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Watch' })).toBeTruthy();
  await back();
  expect(screen.getByRole('heading', { name: 'Season One' })).toBeTruthy();
  await back();
  expect(screen.getByRole('heading', { name: series.title })).toBeTruthy();
});
it('handles artwork failure without losing the title or navigation', async () => {
  setup();
  mount();
  const card = await screen.findByRole('button', { name: /A quiet horizon/ });
  await waitFor(() => expect(card.querySelector('img')).not.toBeNull());
  const image = card.querySelector('img')!;
  fireEvent.error(image);
  expect(card.querySelector('img')).toBeNull();
  fireEvent.click(card);
  expect(await screen.findByRole('heading', { name: movie.title })).toBeTruthy();
});
it('ignores a delayed detail response after Back and clears frames for a different account', async () => {
  const fetcher = setup();
  const original = fetcher.getMockImplementation()!;
  let resolve!: (value: unknown) => void;
  fetcher.mockImplementation(async (path) =>
    path.includes('/works/work_movie')
      ? await new Promise<any>((r) => {
          resolve = r;
        })
      : original(path),
  );
  const view = mount();
  fireEvent.click(await screen.findByRole('button', { name: /A quiet horizon/ }));
  expect(screen.getByText('Loading details…')).toBeTruthy();
  await back();
  await act(async () => {
    resolve({ ok: true, json: async () => ({ work: movie, sources: { items: [], total: 0 } }) });
  });
  expect(screen.queryByRole('heading', { name: movie.title })).toBeTruthy(); // Home hero only
  expect(screen.queryByLabelText('Source/version')).toBeNull();
  view.unmount();
  setup({ empty: true });
  render(
    <Cinema
      key="two"
      user={{ ...user, id: 'two', displayName: 'Bob' }}
      pending={false}
      error=""
      onSignOut={() => {}}
    />,
  );
  expect(await screen.findByText(/No movies indexed yet/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /A quiet horizon/ })).toBeNull();
});

it('loads Home automatically without a routine refresh control or triggering catalog sync', async () => {
  const fetcher = setup();
  mount();
  expect(await screen.findByRole('button', { name: /A quiet horizon/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Refresh Home' })).toBeNull();
  expect(fetcher.mock.calls.some(([path]) => path.includes('/sync'))).toBe(false);
});
it('reuses Settings when returning from Browse without duplicate form IDs', async () => {
  setup();
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await screen.findByLabelText('Display name');
  fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await waitFor(() => expect(screen.getByLabelText('Display name').closest('[hidden]')).toBeNull());
  expect(document.querySelectorAll('#server-name')).toHaveLength(1);
});
it('bounds featured choices to eight indexed titles and includes both movie and series pages', async () => {
  const fetcher = setup();
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path) =>
    path.includes('/works?type=movie')
      ? {
          ok: true,
          status: 200,
          json: async () => ({
            items: Array.from({ length: 24 }, (_, i) => ({
              ...movie,
              id: `work_${i}`,
              title: `Indexed movie ${i}`,
              representativeItemId: `movie_${i}`,
            })),
            total: 24,
            offset: 0,
            limit: 24,
          }),
        }
      : original(path),
  );
  mount();
  await screen.findByRole('button', { name: 'Show featured title 8 of 8' });
  expect(screen.getByLabelText('Featured titles').querySelectorAll('button')).toHaveLength(8);
  fireEvent.click(screen.getByRole('button', { name: 'Next featured title' }));
  expect(screen.getByRole('heading', { name: series.title })).toBeTruthy();
  expect(fetcher.mock.calls.filter(([path]) => path.includes('/works?'))).toHaveLength(2);
});

it('reloads initially empty Home shelves after returning from Settings', async () => {
  const options = { empty: true };
  setup(options);
  mount();
  await screen.findByText(/No movies indexed yet/);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await screen.findByRole('heading', { name: 'Settings → Media Servers' });
  options.empty = false;
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  await waitFor(() => expect(screen.getAllByText(movie.title).length).toBeGreaterThan(0));
  expect(screen.queryByText(/No movies indexed yet/)).toBeNull();
});

it('Browse Movies and TV Shows automatically load aggregated grids and keep maintenance in Settings', async () => {
  const fetcher = setup();
  mount();
  await screen.findAllByText(movie.title);
  fireEvent.click(screen.getByRole('button', { name: /^Browse/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Movies' }));
  await screen.findByRole('heading', { name: 'Movies', level: 1 });
  expect(document.querySelector('.poster-grid .poster-card')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Refresh catalog' })).toBeNull();
  expect(screen.queryByText(/Synchronized metadata is visible to all/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Browse/ }));
  fireEvent.click(screen.getByRole('button', { name: 'TV Shows' }));
  await screen.findByRole('heading', { name: 'TV Shows', level: 1 });
  await back();
  expect(screen.getByRole('heading', { name: 'Movies', level: 1 })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await screen.findByRole('button', { name: 'Refresh catalog' });
  expect(screen.queryByRole('navigation', { name: 'Catalog libraries' })).toBeNull();
  expect(fetcher.mock.calls.some(([path]) => path.includes('/works?type=movie'))).toBe(true);
  expect(fetcher.mock.calls.some(([path]) => path.includes('/works?type=series'))).toBe(true);
});

it('hides a single source block and passes that exact item to Watch', async () => {
  setup({ single: true });
  mount();
  fireEvent.click((await screen.findAllByRole('button', { name: /A quiet horizon/ }))[0]!);
  await screen.findByRole('button', { name: 'Watch' });
  expect(screen.queryByLabelText('Source/version')).toBeNull();
  expect(screen.queryByText('About source selection')).toBeNull();
  expect(screen.queryByText('Versions & sources')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
  expect(await screen.findByText('Existing player movie work_movie movie')).toBeTruthy();
});

it('automatically recovers a transient series initial-load failure without clicking Retry', async () => {
  const fetcher = setup();
  const original = fetcher.getMockImplementation()!;
  let seriesAttempts = 0;
  fetcher.mockImplementation(async (path) =>
    path.includes('type=series') && ++seriesAttempts === 1
      ? ({ ok: false, status: 503 } as Response)
      : original(path),
  );
  mount();
  await screen.findByRole('button', { name: /The long way/ }, { timeout: 2500 });
  expect(seriesAttempts).toBe(2);
  expect(screen.queryByRole('button', { name: 'Retry series' })).toBeNull();
});
it('does not retry an expired session as a transient series failure', async () => {
  const fetcher = setup();
  const original = fetcher.getMockImplementation()!;
  let seriesAttempts = 0;
  fetcher.mockImplementation(async (path) => {
    if (path.includes('type=series')) {
      seriesAttempts++;
      return { ok: false, status: 401 } as Response;
    }
    return original(path);
  });
  mount();
  await screen.findByText('Your session has expired. Sign in again.');
  expect(seriesAttempts).toBe(1);
});
it('cancels pending series recovery when the account view is removed', async () => {
  const fetcher = setup();
  const original = fetcher.getMockImplementation()!;
  let seriesAttempts = 0;
  fetcher.mockImplementation(async (path) => {
    if (path.includes('type=series')) {
      seriesAttempts++;
      return { ok: false, status: 503 } as Response;
    }
    return original(path);
  });
  const view = mount();
  await waitFor(() => expect(seriesAttempts).toBe(1));
  view.unmount();
  await new Promise((r) => setTimeout(r, 500));
  expect(seriesAttempts).toBe(1);
});
