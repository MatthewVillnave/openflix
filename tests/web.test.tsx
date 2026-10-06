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
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ libraries: [] })));
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
  expect(screen.getByText(/Playback is not available/)).toBeDefined();
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
