// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MediaServers } from '../apps/web/src/MediaServers.js';
import { App } from '../apps/web/src/App.js';
import * as api from '../apps/web/src/api.js';
const record = {
  id: 'saved',
  type: 'jellyfin',
  name: 'Den',
  baseUrl: 'http://fixture:8096',
  server: { id: 'server', name: 'Fixture', version: '12.1.0' },
  libraries: [{ id: 'movies', name: 'My movies', mediaTypes: ['movie'] }],
  state: 'connected',
  lastError: null,
  lastCheckedAt: 1,
  createdAt: 1,
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('adds, clears password, tests saved connection and reports unconfirmed removal', async () => {
  const call = vi
    .spyOn(api, 'connectorRequest')
    .mockResolvedValueOnce({ connectors: [], credentialStorageConfigured: true })
    .mockResolvedValueOnce({ connector: record })
    .mockResolvedValueOnce({ connector: record })
    .mockResolvedValueOnce({ removed: true, revocation: 'unconfirmed' });
  render(<MediaServers />);
  await screen.findByRole('button', { name: 'Add Jellyfin server' });
  for (const [label, value] of [
    ['Display name', 'Den'],
    ['Jellyfin URL', 'http://fixture:8096'],
    ['Jellyfin username', 'fixture-user'],
    ['Jellyfin password', 'fixture-secret'],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Jellyfin server' }));
  await screen.findByText('My movies');
  expect((screen.getByLabelText('Jellyfin password') as HTMLInputElement).value).toBe('');
  expect(call.mock.calls[1]![1]).toBe('POST');
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect / test' }));
  await screen.findByText('Connection verified using its saved credential.');
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect / remove' }));
  await screen.findByText(/Remote revocation could not be confirmed/);
  expect(screen.queryByText('My movies')).toBeNull();
});
it('disables setup when no master key is configured', async () => {
  vi.spyOn(api, 'connectorRequest').mockResolvedValue({
    connectors: [],
    credentialStorageConfigured: false,
  });
  render(<MediaServers />);
  await screen.findByRole('alert');
  expect(
    (screen.getByRole('button', { name: 'Add Jellyfin server' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it('does not render administration for a normal user', async () => {
  vi.spyOn(api, 'currentUser').mockResolvedValue({
    user: { id: 'u', username: 'viewer', displayName: 'Viewer', role: 'user' },
  });
  const call = vi.spyOn(api, 'connectorRequest');
  render(<App />);
  await screen.findByText('Welcome, Viewer.');
  expect(screen.queryByRole('button', { name: 'Settings · Media Servers' })).toBeNull();
  expect(call).not.toHaveBeenCalled();
});
it('clears a rejected password and presents a useful fixed error', async () => {
  vi.spyOn(api, 'connectorRequest')
    .mockResolvedValueOnce({ connectors: [], credentialStorageConfigured: true })
    .mockRejectedValueOnce(new Error('Jellyfin rejected these credentials.'));
  render(<MediaServers />);
  await screen.findByRole('button', { name: 'Add Jellyfin server' });
  fireEvent.change(screen.getByLabelText('Jellyfin password'), {
    target: { value: 'bad-fixture-secret' },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Add Jellyfin server' }).closest('form')!);
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('Jellyfin rejected'),
  );
  expect((screen.getByLabelText('Jellyfin password') as HTMLInputElement).value).toBe('');
});
