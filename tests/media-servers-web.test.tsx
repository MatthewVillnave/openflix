// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    .mockResolvedValueOnce({
      connectors: [],
      credentialStorageConfigured: true,
      canRegisterServers: true,
      approvedServers: [],
    })
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
  fireEvent.click(screen.getByRole('checkbox'));
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
    .mockResolvedValueOnce({
      connectors: [],
      credentialStorageConfigured: true,
      canRegisterServers: true,
      approvedServers: [],
    })
    .mockRejectedValueOnce(new Error('Jellyfin rejected these credentials.'));
  render(<MediaServers />);
  await screen.findByRole('button', { name: 'Add Jellyfin server' });
  fireEvent.change(screen.getByLabelText('Jellyfin password'), {
    target: { value: 'bad-fixture-secret' },
  });
  fireEvent.change(screen.getByLabelText('Jellyfin URL'), {
    target: { value: 'http://fixture:8096' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByRole('button', { name: 'Add Jellyfin server' }).closest('form')!);
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('Jellyfin rejected'),
  );
  expect((screen.getByLabelText('Jellyfin password') as HTMLInputElement).value).toBe('');
});
it('discovery and selection never authenticate; address edits invalidate confirmation and clear password', async () => {
  const call = vi
    .spyOn(api, 'connectorRequest')
    .mockResolvedValueOnce({
      connectors: [],
      credentialStorageConfigured: true,
      canRegisterServers: true,
      approvedServers: [],
    })
    .mockResolvedValueOnce({
      candidates: [
        { name: '<b>Untrusted</b>', serverId: 'one', baseUrl: 'http://192.168.1.20:8096' },
      ],
      unavailable: false,
    });
  render(<MediaServers />);
  await screen.findByRole('button', { name: 'Find Jellyfin servers' });
  fireEvent.click(screen.getByRole('button', { name: 'Find Jellyfin servers' }));
  fireEvent.click(
    await screen.findByRole('button', { name: '<b>Untrusted</b> · http://192.168.1.20:8096' }),
  );
  expect(call).toHaveBeenCalledTimes(2);
  expect(call.mock.calls[1]?.slice(0, 3)).toEqual(['/discover', 'POST', {}]);
  expect(
    (screen.getByRole('button', { name: 'Add Jellyfin server' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Jellyfin password'), {
    target: { value: 'synthetic-password' },
  });
  fireEvent.change(screen.getByLabelText('Jellyfin URL'), {
    target: { value: 'https://different.example' },
  });
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText('Jellyfin password') as HTMLInputElement).value).toBe('');
  expect(call).toHaveBeenCalledTimes(2);
});
it('aborts an in-flight discovery when account/settings tree unmounts', async () => {
  let signal: AbortSignal | undefined;
  vi.spyOn(api, 'connectorRequest')
    .mockResolvedValueOnce({
      connectors: [],
      credentialStorageConfigured: true,
      canRegisterServers: true,
      approvedServers: [],
    })
    .mockImplementation((_p, _m, _b, s) => {
      signal = s;
      return new Promise(() => {});
    });
  const view = render(<MediaServers />);
  await screen.findByRole('button', { name: 'Find Jellyfin servers' });
  fireEvent.click(screen.getByRole('button', { name: 'Find Jellyfin servers' }));
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

it('notifies the parent when a connection finishes after leaving Settings', async () => {
  let complete!: (value: unknown) => void;
  vi.spyOn(api, 'connectorRequest')
    .mockResolvedValueOnce({
      connectors: [],
      credentialStorageConfigured: true,
      canRegisterServers: true,
      approvedServers: [],
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
  const changed = vi.fn();
  const view = render(<MediaServers onChanged={changed} />);
  await screen.findByRole('button', { name: 'Add Jellyfin server' });
  fireEvent.change(screen.getByLabelText('Jellyfin URL'), {
    target: { value: 'http://fixture:8096' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByRole('button', { name: 'Add Jellyfin server' }).closest('form')!);
  view.unmount();
  await act(async () => complete({ connector: record }));
  expect(changed).toHaveBeenCalledTimes(1);
});
it('notifies the parent when disconnect finishes after leaving Settings', async () => {
  let complete!: (value: unknown) => void;
  vi.spyOn(api, 'connectorRequest')
    .mockResolvedValueOnce({
      connectors: [record],
      credentialStorageConfigured: true,
      canRegisterServers: true,
      approvedServers: [],
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
  const changed = vi.fn();
  const view = render(<MediaServers onChanged={changed} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Disconnect / remove' }));
  view.unmount();
  await act(async () => complete({ removed: true, revocation: 'confirmed' }));
  expect(changed).toHaveBeenCalledTimes(1);
});
it('requires an explicit confirmation before forgetting an approved identity', async () => {
  const call = vi
    .spyOn(api, 'connectorRequest')
    .mockResolvedValueOnce({
      connectors: [],
      credentialStorageConfigured: true,
      canRegisterServers: true,
      approvedServers: [
        { baseUrl: record.baseUrl, serverId: '11111111111111111111111111111111', name: 'Fixture' },
      ],
    })
    .mockResolvedValueOnce({ removed: true });
  render(<MediaServers />);
  fireEvent.click(await screen.findByText('Manage approved server identities'));
  const button = screen.getByRole('button', {
    name: 'Forget old server identity',
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(
    screen.getByRole('checkbox', { name: /old server identity should be forgotten/i }),
  );
  fireEvent.click(button);
  await screen.findByText(
    'Old server identity forgotten. Verify the replacement before connecting.',
  );
  expect(call.mock.calls[1]).toEqual([
    '/approved-server',
    'DELETE',
    { baseUrl: record.baseUrl, serverId: '11111111111111111111111111111111' },
  ]);
});
