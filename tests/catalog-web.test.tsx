// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Catalog } from '../apps/web/src/Catalog.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const library = {
  id: 'lib_test',
  connectorId: 'connection',
  connectorName: 'Household',
  upstreamId: 'upstream',
  name: 'Tv shows',
  type: 'television',
  upstreamType: null,
  lastSyncedAt: 1,
};
const item = {
  id: 'item_test',
  connectorId: 'connection',
  upstreamId: 'upstream-item',
  libraryIds: ['lib_test'],
  title: '<img src=x onerror=alert(1)>',
  type: 'series',
  providerIds: {},
  syncedAt: 1,
};
function fixture() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input);
    const data = path.includes('/connectors')
      ? { connectors: [{ id: 'connection', name: 'Household' }] }
      : path.endsWith('/libraries')
        ? { libraries: [library] }
        : path.includes('/items?')
          ? { items: [item], total: 51, offset: path.includes('offset=50') ? 50 : 0, limit: 50 }
          : path.includes('/items/item_test')
            ? { item }
            : path.includes('/sync/')
              ? { connectorId: 'connection', state: 'successful', error: null, lastSuccessfulAt: 1 }
              : {};
    return new Response(JSON.stringify(data), { status: 200 });
  });
}
it('ordinary users browse safe text, filter/page and inspect details without connector administration', async () => {
  const requests = fixture();
  const view = render(<Catalog admin={false} />);
  fireEvent.click(await screen.findByRole('button', { name: /Tv shows/ }));
  fireEvent.click(await screen.findByRole('button', { name: item.title }));
  await screen.findByRole('article', { name: 'Item details' });
  expect(view.container.querySelector('img')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Sync Household' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() =>
    expect(requests.mock.calls.some(([url]) => String(url).includes('offset=50'))).toBe(true),
  );
  fireEvent.change(screen.getByLabelText('Media type'), { target: { value: 'episode' } });
  await waitFor(() =>
    expect(requests.mock.calls.some(([url]) => String(url).includes('type=episode'))).toBe(true),
  );
  for (const [url, options] of requests.mock.calls) {
    expect(String(url)).toMatch(/^\/api\/v1\/catalog\//);
    expect(options?.credentials).toBe('same-origin');
  }
});
it('administrators explicitly trigger sync and can read status', async () => {
  const requests = fixture();
  render(<Catalog admin />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sync Household' }));
  await screen.findByRole('status');
  expect(
    requests.mock.calls.some(
      ([url, options]) =>
        String(url) === '/api/v1/catalog/sync/connection' &&
        options?.method === 'POST' &&
        options.body === '{}',
    ),
  ).toBe(true);
});
it('shows a sanitized catalog error instead of upstream response text', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('private token and arbitrary error', { status: 500 }),
  );
  render(<Catalog admin={false} />);
  expect((await screen.findByRole('alert')).textContent).toBe('Could not load catalog libraries.');
  expect(screen.queryByText(/private token/)).toBeNull();
});
