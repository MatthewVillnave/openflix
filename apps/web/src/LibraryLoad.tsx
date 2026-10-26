import { useEffect, useRef, useState } from 'react';
import type { CatalogSyncStatus, ConnectorSummary } from '@openflix/shared';

/** Lives with the signed-in Cinema, so leaving Settings does not abandon initial loading. */
export function LibraryLoad({ revision, onReady }: { revision: number; onReady: () => void }) {
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const failedIds = useRef(new Set<string>());
  const published = useRef(new Map<string, number | null>());
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 30 * 60 * 1000;
    const attempted = new Set<string>();
    async function request<T>(path: string, post = false): Promise<T> {
      const response = await fetch('/api/v1/' + path, {
        credentials: 'same-origin',
        signal: controller.signal,
        ...(post
          ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
          : {}),
      });
      if (!response.ok)
        throw new Error('Library loading is unavailable. Check your connection and retry.');
      return response.json() as Promise<T>;
    }
    async function check() {
      try {
        const { connectors } = await request<{ connectors: ConnectorSummary[] }>('connectors');
        let running = false;
        let hasFailure = false;
        for (const connection of connectors.slice(0, 10)) {
          if (controller.signal.aborted) return;
          const path = 'catalog/sync/' + encodeURIComponent(connection.id);
          let status = await request<CatalogSyncStatus>(path);
          if (controller.signal.aborted) return;
          if (
            (status.state === 'never' || (retry > 0 && failedIds.current.has(connection.id))) &&
            !attempted.has(connection.id) &&
            !running
          ) {
            attempted.add(connection.id);
            failedIds.current.delete(connection.id);
            status = await request<CatalogSyncStatus>(path, true);
          }
          if (controller.signal.aborted) return;
          if (status.state === 'syncing' || status.state === 'never') running = true;
          if (status.state === 'failed') {
            hasFailure = true;
            failedIds.current.add(connection.id);
          }
          if (
            status.state === 'successful' &&
            published.current.get(connection.id) !== status.lastSuccessfulAt
          ) {
            published.current.set(connection.id, status.lastSuccessfulAt);
            onReady();
          }
        }
        if (controller.signal.aborted) return;
        setFailed(hasFailure);
        setMessage(
          running
            ? 'Loading your libraries… You can keep browsing.'
            : hasFailure
              ? 'A library could not finish loading. Check your connection and retry.'
              : '',
        );
        if (running) {
          if (Date.now() >= deadline)
            throw new Error(
              'Library loading is taking longer than expected. Retry to check its status.',
            );
          timer = setTimeout(() => void check(), 2000);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setFailed(true);
          setMessage(error instanceof Error ? error.message : 'Library loading failed.');
        }
      }
    }
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [revision, retry, onReady]);
  return message ? (
    <div className="view-message" role={failed ? 'alert' : 'status'}>
      {message}
      {failed && <button onClick={() => setRetry((n) => n + 1)}>Retry library loading</button>}
    </div>
  ) : null;
}
