import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import type { CatalogItem, PlaybackFormat, PlaybackView } from '@openflix/shared';
import { playbackFormats } from '@openflix/shared';
const message = (status: number) =>
  status === 415
    ? 'This source cannot be played with the supported direct or HLS profiles.'
    : status === 401 || status === 403
      ? 'Your account is not authorized for playback.'
      : status === 410
        ? 'Playback expired. Return to the catalog and start again.'
        : status === 429
          ? 'Playback capacity is busy. Stop another player and retry.'
          : 'Playback is unavailable. Check the media server and try again.';
async function mutation<T>(path: string, body: unknown, keepalive = false): Promise<T> {
  const response = await fetch(`/api/v1/playback${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    keepalive,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(message(response.status));
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
const nativeHls = (node: HTMLMediaElement) =>
  Boolean(node.canPlayType('application/vnd.apple.mpegurl')) &&
  (/Apple/.test(navigator.vendor) || !Hls.isSupported());
export function Player({ item }: { item: CatalogItem }) {
  const [session, setSession] = useState<PlaybackView | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const started = useRef(false),
    reporting = useRef(false),
    pendingReport = useRef(false),
    mounted = useRef(true),
    activeSession = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function prepare() {
    setLoading(true);
    setError('');
    const video = document.createElement('video'),
      audio = document.createElement('audio');
    const formats = (Object.keys(playbackFormats) as PlaybackFormat[]).filter((f) =>
      f === 'hls-h264-aac'
        ? video.canPlayType(playbackFormats[f]) !== '' || Hls.isSupported()
        : (playbackFormats[f].startsWith('video') ? video : audio).canPlayType(
            playbackFormats[f],
          ) !== '',
    );
    if (!formats.length) {
      setError('This browser does not support the supported playback formats.');
      setLoading(false);
      return;
    }
    try {
      const result = await mutation<PlaybackView>('/sessions', {
        itemId: item.id,
        profile: { formats },
      });
      // Only the known same-origin route shape can ever become a media-element source.
      if (!/^\/api\/v1\/playback\/sessions\/[a-f0-9-]{36}\/stream$/.test(result.streamPath))
        throw new Error('Invalid playback response.');
      if (!mounted.current) {
        void mutation(`/sessions/${result.id}/stop`, {}).catch(() => {});
        return;
      }
      started.current = false;
      reporting.current = false;
      pendingReport.current = false;
      activeSession.current = result.id;
      setSession(result);
      setStatus('Ready. Press Play.');
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  async function report(begin = false) {
    const node = media.current;
    if (!session || !node || activeSession.current !== session.id || (!started.current && !begin))
      return;
    if (reporting.current) {
      pendingReport.current = true;
      return;
    }
    reporting.current = true;
    try {
      await mutation(`/sessions/${session.id}/progress`, {
        event: started.current ? 'progress' : 'start',
        positionMs: Math.min(session.durationMs, Math.max(0, Math.round(node.currentTime * 1000))),
        paused: node.paused,
      });
      if (activeSession.current !== session.id) return;
      started.current = true;
    } catch (e) {
      if (activeSession.current !== session.id) return;
      if (mounted.current) {
        setError((e as Error).message);
        node.pause();
        node.removeAttribute('src');
        node.load();
        setSession(null);
      }
      pendingReport.current = false;
    } finally {
      if (activeSession.current !== session.id) return;
      reporting.current = false;
      if (pendingReport.current) {
        pendingReport.current = false;
        void report();
      }
    }
  }
  useEffect(() => {
    if (!session) return;
    const node = media.current;
    let hls: Hls | undefined;
    if (node && session.mode !== 'direct' && nativeHls(node)) node.src = session.streamPath;
    if (node && session.mode !== 'direct' && !nativeHls(node)) {
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: false,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxBufferSize: 30 * 1024 * 1024,
          backBufferLength: 30,
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && mounted.current) {
            setError('HLS playback failed. Return to the catalog and retry.');
            setSession(null);
          }
        });
        hls.attachMedia(node);
        hls.loadSource(session.streamPath);
      } else {
        setError('HLS is unsupported in this browser.');
        setSession(null);
      }
    }
    const timer = setInterval(() => {
      void report();
    }, 15000);
    const stop = () => {
      void mutation(`/sessions/${session.id}/stop`, {}, true).catch(() => {});
    };
    window.addEventListener('pagehide', stop);
    return () => {
      if (activeSession.current === session.id) activeSession.current = null;
      clearInterval(timer);
      window.removeEventListener('pagehide', stop);
      hls?.destroy();
      node?.pause();
      node?.removeAttribute('src');
      node?.load();
      stop();
    };
    // This effect owns the session lifetime; report reads the captured session and live media/ref state.
  }, [session]);
  const events = {
    controls: true,
    preload: 'metadata' as const,
    src: session?.mode === 'direct' ? session.streamPath : undefined,
    onPlaying: () => {
      setStatus('Playing');
      void report(true);
    },
    onPause: () => {
      setStatus('Paused');
      void report();
    },
    onSeeked: () => {
      void report();
    },
    onWaiting: () => setStatus('Loading media…'),
    onLoadedMetadata: () => setStatus('Ready. Press Play.'),
    onEnded: () => {
      void report().finally(() => setSession(null));
    },
    onError: () => {
      setError('Media playback failed or authorization expired. Return to the catalog and retry.');
      setSession(null);
    },
  };
  return (
    <section aria-label="Media player">
      <p>
        Playback uses this server’s connector identity and may update its Jellyfin watch progress.
      </p>
      {!session ? (
        <button disabled={loading} onClick={() => void prepare()}>
          {loading ? 'Preparing playback…' : 'Prepare playback'}
        </button>
      ) : (
        <>
          <h4>{item.title}</h4>
          <p>Playback mode: {session.mode}</p>
          {session.kind === 'video' ? (
            <video ref={media} playsInline {...events} aria-label="Video player" />
          ) : (
            <audio ref={media} {...events} aria-label="Audio player" />
          )}
          <button
            onClick={() => {
              void media.current
                ?.play()
                .catch(() => setError('Press the native Play control to begin playback.'));
            }}
          >
            Play media
          </button>
          <button onClick={() => media.current?.pause()}>Pause media</button>
          <button onClick={() => setSession(null)}>Return to catalog</button>
          <p role="status">{status}</p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
