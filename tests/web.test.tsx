// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../apps/web/src/App.js';
import * as api from '../apps/web/src/api.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('allows sign in and sign out without implying a Jellyfin connection', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).endsWith('/connectors') ? { connectors: [] } : { items: [], total: 0 },
        ),
      ),
  );
  vi.spyOn(api, 'currentUser').mockRejectedValue(new api.ApiError(401));
  const login = vi.spyOn(api, 'login').mockResolvedValue({
    user: { id: '1', username: 'alice', displayName: 'Alice', role: 'user' },
  });
  vi.spyOn(api, 'logout').mockResolvedValue();
  render(<App />);
  await screen.findByLabelText('Username');
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByText('Welcome, Alice.');
  expect(login).toHaveBeenCalledWith({ username: 'alice', password: 'test-password' });
  fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
  fireEvent.click(screen.getByRole('button', { name: 'Movies' }));
  await screen.findByRole('heading', { name: 'Movies', level: 1 });
  expect(screen.queryByText(/Playback is available to administrators/)).toBeNull();
  expect(screen.queryByText(/Synchronized metadata is visible to all/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByLabelText('Password');
  expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
});
it('shows authentication failure and clears the password', async () => {
  vi.spyOn(api, 'currentUser').mockRejectedValue(new api.ApiError(401));
  vi.spyOn(api, 'login').mockRejectedValue(new api.ApiError(401));
  render(<App />);
  await screen.findByLabelText('Username');
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Invalid username or password'),
  );
  expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
});
it('distinguishes unavailable server from an unauthenticated session', async () => {
  vi.spyOn(api, 'currentUser').mockRejectedValue(new Error('offline'));
  render(<App />);
  expect((await screen.findByRole('alert')).textContent).toContain('server is unavailable');
});
it('omits the internal milestone badge from the login screen', async () => {
  vi.spyOn(api, 'currentUser').mockRejectedValue(new api.ApiError(401));
  render(<App />);
  await screen.findByLabelText('Username');
  expect(screen.queryByText(/MULTIPLE SERVERS|M5/)).toBeNull();
});

it('hard refresh waits for delayed session restoration then automatically loads both shelves', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.history.replaceState({ openflix: 'previous-session', index: 3 }, '');
  let restore!: (value: any) => void;
  vi.spyOn(api, 'currentUser').mockImplementation(
    () =>
      new Promise((resolve) => {
        restore = resolve;
      }),
  );
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/connectors') ? { connectors: [] } : { items: [], total: 0 },
          ),
        ),
    );
  render(<App />);
  await screen.findByText('Checking your session…');
  expect(fetcher).not.toHaveBeenCalled();
  restore({ user: { id: 'restored', username: 'viewer', displayName: 'Viewer', role: 'user' } });
  await screen.findByText(/No series indexed yet/);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('type=series'))).toBe(true);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('type=movie'))).toBe(true);
  expect(window.history.state.index).toBe(0);
});
it('offers owner creation only on an empty installation and signs in after creation', async () => {
  vi.spyOn(api, 'currentUser').mockRejectedValue(new api.ApiError(401));
  vi.spyOn(api, 'setupStatus').mockResolvedValue({ setupRequired: true });
  const create = vi.spyOn(api, 'createOwner').mockResolvedValue();
  vi.spyOn(api, 'login').mockResolvedValue({
    user: { id: '1', username: 'owner', displayName: 'Owner', role: 'admin' },
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ items: [], total: 0, connectors: [] })),
  );
  render(<App />);
  await screen.findByRole('heading', { name: 'Create your account.' });
  expect(screen.getByText(/administrator of this installation/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'owner' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password-long' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('Welcome, Owner.');
  expect(create).toHaveBeenCalledWith({ username: 'owner', password: 'test-password-long' });
});
