// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UnifiedCatalog } from '../apps/web/src/UnifiedCatalog.js';
vi.mock('../apps/web/src/Player.js', () => ({
  Player: ({ groupId, sourceItemId }: { groupId: string; sourceItemId?: string }) => (
    <p>
      Player {groupId} {sourceItemId ?? 'automatic'}
    </p>
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const work = {
  id: 'work_1',
  title: '<script>Shared movie</script>',
  type: 'movie',
  representativeItemId: 'item_a',
  sourceCount: 2,
  connectionCount: 2,
  memberCount: 2,
};
function mock() {
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => {
      if (url.endsWith('/libraries'))
        return {
          libraries: [
            { connectorId: 'a', connectorName: 'Server A' },
            { connectorId: 'b', connectorName: 'Server B' },
          ],
        };
      if (url.includes('/works?')) return { items: [work], offset: 0, limit: 24, total: 1 };
      if (url.includes('/works/work_1'))
        return {
          work,
          sources: {
            items: [
              {
                itemId: 'item_a',
                connectorName: 'Server A',
                edition: 'theatrical',
                versionLabels: ['MP4'],
              },
              {
                itemId: 'item_b',
                connectorName: 'Server B',
                edition: 'theatrical',
                versionLabels: ['MKV'],
              },
            ],
            offset: 0,
            limit: 24,
            total: 2,
          },
        };
      return { item: { id: url.split('/').at(-1), title: work.title, type: 'movie' } };
    },
  }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
it('browses safe metadata from OpenFlix only and explicitly selects a source', async () => {
  const fetcher = mock();
  render(<UnifiedCatalog admin />);
  fireEvent.click(screen.getByRole('button', { name: 'Unified catalog' }));
  fireEvent.click(await screen.findByRole('button', { name: work.title }));
  expect(await screen.findByText('2 indexed sources · 2 connections')).toBeTruthy();
  expect(document.querySelector('script')).toBeNull();
  fireEvent.change(screen.getByLabelText('Source/version'), { target: { value: 'item_b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open player' }));
  expect(await screen.findByText('Player work_1 item_b')).toBeTruthy();
  expect(fetcher.mock.calls.every(([url]) => url.startsWith('/api/v1/catalog/'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close player / choose another source' }));
  expect(screen.queryByText('Player work_1 item_b')).toBeNull();
});
it('keeps ordinary authenticated users browse-only with honest indexed wording', async () => {
  mock();
  render(<UnifiedCatalog admin={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Unified catalog' }));
  fireEvent.click(await screen.findByRole('button', { name: work.title }));
  await waitFor(() =>
    expect(screen.getByText('Playback is restricted to administrators.')).toBeTruthy(),
  );
  expect(screen.queryByRole('button', { name: 'Open player' })).toBeNull();
  expect(screen.getByText(/not current availability/)).toBeTruthy();
});
