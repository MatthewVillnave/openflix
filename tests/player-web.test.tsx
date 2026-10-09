// @vitest-environment jsdom
import React from 'react';
import Hls from 'hls.js';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Player } from '../apps/web/src/Player.js';
import type { CatalogItem } from '../packages/shared/dist/index.js';
const item: CatalogItem = {
  id: 'item_fixture',
  libraryIds: [],
  libraryId: undefined,
  connectorId: 'source',
  upstreamId: 'upstream',
  title: '<script>data</script>',
  type: 'movie',
  providerIds: {},
  syncedAt: 1,
} as CatalogItem;
const session = {
  id: '11111111-1111-4111-8111-111111111111',
  itemId: item.id,
  kind: 'video',
  mode: 'direct',
  contentType: 'video/mp4',
  durationMs: 12000,
  expiresAt: Date.now() + 60000,
  streamPath: '/api/v1/playback/sessions/11111111-1111-4111-8111-111111111111/stream',
};
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('prepares only a catalog identity and bounded capabilities, then reports actual media state and cleans up', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (url) =>
      new Response(String(url).endsWith('/sessions') ? JSON.stringify(session) : null, {
        status: String(url).endsWith('/sessions') ? 201 : 204,
      }),
  );
  const view = render(<Player item={item} />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare playback' }));
  const media = (await screen.findByLabelText('Video player')) as HTMLVideoElement;
  expect(media.getAttribute('src')).toBe(session.streamPath);
  expect(view.container.querySelector('script')).toBeNull();
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
    itemId: item.id,
    profile: { formats: ['hls-h264-aac', 'mp4-h264-aac', 'webm-vp8-opus', 'mp3', 'wav'] },
  });
  Object.defineProperty(media, 'currentTime', { value: 3.5, configurable: true });
  Object.defineProperty(media, 'paused', { value: false, configurable: true });
  fireEvent.playing(media);
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([url, options]) =>
          String(url).endsWith('/progress') &&
          JSON.parse(options!.body as string).positionMs === 3500,
      ),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Return to catalog' }));
  await waitFor(() =>
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/stop'))).toBe(true),
  );
});
it('shows unsupported media clearly without loading a stream', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 415 }));
  render(<Player item={item} />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare playback' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'supported direct or HLS profiles',
  );
  expect(screen.queryByLabelText('Video player')).toBeNull();
});
it('never loads a privileged or arbitrary server-provided URL', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ ...session, streamPath: 'https://evil.invalid/stream?token=secret' }),
      { status: 201 },
    ),
  );
  render(<Player item={item} />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare playback' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Invalid playback response');
  expect(screen.queryByLabelText('Video player')).toBeNull();
});
it('renders native audio controls and stops the session when navigating away', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async (url) =>
        new Response(
          String(url).endsWith('/sessions') ? JSON.stringify({ ...session, kind: 'audio' }) : null,
          { status: String(url).endsWith('/sessions') ? 201 : 204 },
        ),
    );
  const view = render(<Player item={{ ...item, type: 'audio' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare playback' }));
  expect(((await screen.findByLabelText('Audio player')) as HTMLAudioElement).controls).toBe(true);
  view.unmount();
  await waitFor(() =>
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/stop'))).toBe(true),
  );
});

it('uses native HLS on capable browsers with same-origin URL and inline playback', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (url) =>
      new Response(
        String(url).endsWith('/sessions')
          ? JSON.stringify({
              ...session,
              mode: 'remux',
              contentType: 'application/vnd.apple.mpegurl',
            })
          : null,
        { status: String(url).endsWith('/sessions') ? 201 : 204 },
      ),
  );
  render(<Player item={item} />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare playback' }));
  const media = await screen.findByLabelText('Video player');
  await waitFor(() => expect(media.getAttribute('src')).toBe(session.streamPath));
  expect(media.hasAttribute('playsinline')).toBe(true);
});
it('attaches and destroys HLS.js when native HLS is unavailable', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type) =>
    type === 'application/vnd.apple.mpegurl' ? '' : 'probably',
  );
  vi.spyOn(Hls, 'isSupported').mockReturnValue(true);
  const attach = vi.spyOn(Hls.prototype, 'attachMedia').mockImplementation(() => {});
  const load = vi.spyOn(Hls.prototype, 'loadSource').mockImplementation(() => {});
  const destroy = vi.spyOn(Hls.prototype, 'destroy').mockImplementation(() => {});
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (url) =>
      new Response(
        String(url).endsWith('/sessions')
          ? JSON.stringify({
              ...session,
              mode: 'transcode',
              contentType: 'application/vnd.apple.mpegurl',
            })
          : null,
        { status: String(url).endsWith('/sessions') ? 201 : 204 },
      ),
  );
  const view = render(<Player item={item} />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare playback' }));
  await screen.findByLabelText('Video player');
  expect(attach).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledWith(session.streamPath);
  view.unmount();
  expect(destroy).toHaveBeenCalledOnce();
});
