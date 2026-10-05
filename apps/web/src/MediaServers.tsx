import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  ConnectorSummary,
  ConnectorsResponse,
  ConnectorResponse,
  RemoveConnectorResponse,
} from '@openflix/protocol';
import { connectorRequest } from './api.js';
export function MediaServers() {
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  async function refresh() {
    const data = await connectorRequest<ConnectorsResponse>();
    setConnectors(data.connectors);
    setConfigured(data.credentialStorageConfigured);
  }
  useEffect(() => {
    refresh()
      .catch(() => setMessage('Could not load media servers.'))
      .finally(() => setLoading(false));
  }, []);
  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const body = { name, baseUrl, username, password };
    setPassword('');
    try {
      const result = await connectorRequest<ConnectorResponse>('', 'POST', body);
      setConnectors((current) => [...current, result.connector]);
      setName('');
      setBaseUrl('');
      setUsername('');
      setMessage('Jellyfin connected. Accessible libraries are listed below.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      body.password = '';
      setBusy(false);
    }
  }
  async function operate(id: string, remove: boolean) {
    setBusy(true);
    setMessage('');
    try {
      if (remove) {
        const result = await connectorRequest<RemoveConnectorResponse>(`/${id}`, 'DELETE');
        setConnectors((current) => current.filter((item) => item.id !== id));
        setMessage(
          result.revocation === 'confirmed'
            ? 'Connection removed and its Jellyfin session ended.'
            : 'Connection removed locally. Remote revocation could not be confirmed; revoke the OpenFlix session in Jellyfin when available.',
        );
      } else {
        const result = await connectorRequest<ConnectorResponse>(`/${id}/test`, 'POST', {});
        setConnectors((current) =>
          current.map((item) => (item.id === id ? result.connector : item)),
        );
        setMessage('Connection verified using its saved credential.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed.');
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Media servers">
      <h3>Settings → Media Servers</h3>
      <p>
        Connect Jellyfin to view accessible libraries. Media import and playback are not available
        yet.
      </p>
      {loading ? (
        <p role="status">Loading media servers…</p>
      ) : (
        <>
          {!configured && (
            <p role="alert">
              The operator must configure OPENFLIX_MASTER_KEY before adding a media server.
            </p>
          )}
          <form onSubmit={add}>
            <h4>Add Server · Jellyfin</h4>
            <label htmlFor="server-name">Display name</label>
            <input
              id="server-name"
              required
              maxLength={128}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy || !configured}
            />
            <label htmlFor="server-url">Jellyfin URL</label>
            <input
              id="server-url"
              type="url"
              required
              maxLength={2048}
              placeholder="https://jellyfin.example"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={busy || !configured}
            />
            {baseUrl.startsWith('http:') && (
              <p>HTTP sends credentials without TLS. Use it only on a trusted LAN.</p>
            )}
            <label htmlFor="jellyfin-username">Jellyfin username</label>
            <input
              id="jellyfin-username"
              required
              maxLength={256}
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy || !configured}
            />
            <label htmlFor="jellyfin-password">Jellyfin password</label>
            <input
              id="jellyfin-password"
              type="password"
              required
              maxLength={1024}
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy || !configured}
            />
            <button disabled={busy || !configured}>
              {busy ? 'Working…' : 'Add Jellyfin server'}
            </button>
          </form>
          {connectors.map((connector) => (
            <article key={connector.id}>
              <h4>{connector.name}</h4>
              <p>{connector.baseUrl}</p>
              <p>
                {connector.server.name} · Jellyfin {connector.server.version} · {connector.state}
              </p>
              {connector.state === 'unverified' && (
                <p>Saved connection; reconnect to refresh its status and libraries.</p>
              )}
              <ul>
                {connector.libraries.map((library) => (
                  <li key={library.id}>{library.name}</li>
                ))}
              </ul>
              {connector.libraries.length === 0 && <p>No accessible libraries.</p>}
              <button type="button" disabled={busy} onClick={() => operate(connector.id, false)}>
                Reconnect / test
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => operate(connector.id, true)}
              >
                Disconnect / remove
              </button>
            </article>
          ))}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
