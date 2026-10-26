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
  const media = (await screen.findByLabelText('Video player')) as HTMLVideoElement;
  expect(media.getAttribute('src')).toBe(session.streamPath);
  expect(media.controls).toBe(true);
  expect(screen.getByRole('region', { name: `Media player: ${item.title}` })).toBeDefined();
  expect(screen.queryByText(/Playback mode:|Playback uses your linked/)).toBeNull();
  expect(screen.queryByRole('heading', { name: item.title })).toBeNull();
  expect(
    screen.queryByRole('button', { name: /Play media|Pause media|Return to catalog/ }),
  ).toBeNull();
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
  view.unmount();
  await waitFor(() =>
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/stop'))).toBe(true),
  );
});
it('shows unsupported media clearly without loading a stream', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 415 }));
  render(<Player item={item} />);
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
  const destroy = vi.spyOn(Hls.prototype, 'destroy').mockImplementation(function (this: Hls) {
    this.trigger(Hls.Events.ERROR, { fatal: true } as never);
  });
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
  await screen.findByLabelText('Video player');
  expect(attach).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledWith(session.streamPath);
  view.unmount();
  await waitFor(() => expect(destroy).toHaveBeenCalledOnce());
  expect(screen.queryByRole('alert')).toBeNull();
});
it('applies personal resume once per authorized session without resetting later seeks', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (url) =>
      new Response(
        String(url).endsWith('/sessions')
          ? JSON.stringify({ ...session, resumePositionMs: 4000 })
          : null,
        { status: String(url).endsWith('/sessions') ? 201 : 204 },
      ),
  );
  render(<Player item={item} />);
  const media = (await screen.findByLabelText('Video player')) as HTMLVideoElement;
  fireEvent.loadedMetadata(media);
  expect(media.currentTime).toBe(4);
  media.currentTime = 7;
  fireEvent.loadedMetadata(media);
  expect(media.currentTime).toBe(7);
});

it('automatically prepares once under StrictMode and rejects rapid duplicate retries', async () => {
  let complete!: (response: Response) => void;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(
    <React.StrictMode>
      <Player item={item} />
    </React.StrictMode>,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: 'Prepare playback' })).toBeNull();
  complete(new Response('{}', { status: 415 }));
  const retry = await screen.findByRole('button', { name: 'Retry playback' });
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('stops a late session after leaving the player without displaying or playing it', async () => {
  let complete!: (response: Response) => void;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((url) =>
    String(url).endsWith('/sessions')
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : Promise.resolve(new Response(null, { status: 204 })),
  );
  const view = render(<Player item={item} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  view.unmount();
  complete(new Response(JSON.stringify(session), { status: 201 }));
  await waitFor(() =>
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/stop'))).toBe(true),
  );
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
});
it('attempts playback after metadata and explains a browser autoplay block without a new session', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('NotAllowedError'));
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (url) =>
      new Response(String(url).endsWith('/sessions') ? JSON.stringify(session) : null, {
        status: String(url).endsWith('/sessions') ? 201 : 204,
      }),
  );
  render(<Player item={item} />);
  fireEvent.loadedMetadata(await screen.findByLabelText('Video player'));
  await screen.findByText('Your browser requires a click. Press Play to begin.');
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/sessions'))).toHaveLength(1);
});
