// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LibraryLoad } from '../apps/web/src/LibraryLoad.js';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const response = (value: unknown) => ({ ok: true, json: async () => value });
it('starts initial loading once, polls to completion and publishes a Home refresh', async () => {
  const ready = vi.fn();
  let state = 'never';
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/connectors')) return response({ connectors: [{ id: 'personal' }] });
    if (init.method === 'POST') state = 'syncing';
    return response({ state, lastSuccessfulAt: state === 'successful' ? 123 : null });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<LibraryLoad revision={0} onReady={ready} />);
  await screen.findByText(/Loading your libraries/);
  expect(fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  state = 'successful';
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(1), { timeout: 3500 });
  expect(screen.queryByText(/Loading your libraries/)).toBeNull();
  expect(fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
});
it('does not loop on failed scans; explicit Retry starts one new attempt', async () => {
  let state = 'failed';
  const ready = vi.fn();
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/connectors')) return response({ connectors: [{ id: 'personal' }] });
    if (init.method === 'POST') state = 'successful';
    return response({ state, lastSuccessfulAt: 123 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<LibraryLoad revision={0} onReady={ready} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry library loading' }));
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
});
it('aborts stale account requests and does not start work or publish after unmount', async () => {
  let resolve!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  const ready = vi.fn();
  const fetcher = vi.fn((_url: string, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Promise((r) => {
      resolve = r;
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<LibraryLoad revision={0} onReady={ready} />);
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(response({ connectors: [{ id: 'previous-account' }] })));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(ready).not.toHaveBeenCalled();
});
it('reloads statuses after a new connection and leaves an empty account idle', async () => {
  let connected = false;
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/connectors'))
      return response({ connectors: connected ? [{ id: 'new' }] : [] });
    return response({
      state: init.method === 'POST' ? 'successful' : 'never',
      lastSuccessfulAt: 10,
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const ready = vi.fn();
  const view = render(<LibraryLoad revision={0} onReady={ready} />);
  await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  connected = true;
  view.rerender(<LibraryLoad revision={1} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
});
