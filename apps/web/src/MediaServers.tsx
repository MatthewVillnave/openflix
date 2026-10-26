import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  DiscoveryResponse,
  ConnectorSummary,
  ConnectorsResponse,
  ConnectorResponse,
  RemoveConnectorResponse,
} from '@openflix/protocol';
import { connectorRequest } from './api.js';
export function MediaServers({ onChanged }: { onChanged?: () => void }) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [approved, setApproved] = useState<ConnectorsResponse['approvedServers']>([]);
  const [canRegister, setCanRegister] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [searching, setSearching] = useState(false);
  const [forget, setForget] = useState('');
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
  const search = useRef<AbortController | null>(null);
  useEffect(() => () => search.current?.abort(), []);
  function chooseAddress(value: string) {
    setBaseUrl(value);
    setConfirmed(false);
    setPassword('');
  }
  async function findServers() {
    const controller = new AbortController();
    search.current?.abort();
    search.current = controller;
    setSearching(true);
    setDiscovery(null);
    setMessage('');
    try {
      const result = await connectorRequest<DiscoveryResponse>(
        '/discover',
        'POST',
        {},
        controller.signal,
      );
      if (!controller.signal.aborted) setDiscovery(result);
    } catch {
      if (!controller.signal.aborted)
        setMessage('Discovery unavailable. You can still enter your Jellyfin URL manually.');
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }
  async function refresh() {
    const data = await connectorRequest<ConnectorsResponse>();
    setConnectors(data.connectors);
    setConfigured(data.credentialStorageConfigured);
    setApproved(data.approvedServers ?? []);
    setCanRegister(data.canRegisterServers ?? false);
  }
  useEffect(() => {
    refresh()
      .catch(() => setMessage('Could not load media servers.'))
      .finally(() => setLoading(false));
  }, []);
  async function add(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) {
      setMessage('Confirm the server address and personal connection before signing in.');
      return;
    }
    setBusy(true);
    setMessage('');
    const body = { name, baseUrl, username, password };
    setPassword('');
    try {
      const result = await connectorRequest<ConnectorResponse>('', 'POST', body);
      onChanged?.();
      if (!alive.current) return;
      setConnectors((current) => [...current, result.connector]);
      if (canRegister) {
        const server = {
          baseUrl: result.connector.baseUrl,
          serverId: result.connector.server.id,
          name: result.connector.server.name,
        };
        setApproved((current) => [
          ...current.filter((item) => item.baseUrl !== server.baseUrl),
          server,
        ]);
      }
      setName('');
      setBaseUrl('');
      setConfirmed(false);
      setUsername('');
      setMessage('Jellyfin connected. Your libraries will load automatically.');
    } catch (error) {
      if (alive.current) setMessage(error instanceof Error ? error.message : 'Connection failed.');
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
        onChanged?.();
        if (!alive.current) return;
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
      <p>Connect your Jellyfin account. Your accessible libraries load automatically.</p>
      {loading ? (
        <p role="status">Loading media servers…</p>
      ) : (
        <>
          {!configured && (
            <p role="alert">
              The operator must configure OPENFLIX_MASTER_KEY before adding a media server.
            </p>
          )}
          <p>
            Only your OpenFlix account can use this Jellyfin connection. Signing out keeps your
            encrypted connection saved; Disconnect removes it and attempts to end its Jellyfin
            session.
          </p>
          {canRegister && (
            <>
              <button type="button" disabled={searching || busy} onClick={() => void findServers()}>
                {searching ? 'Finding servers…' : 'Find Jellyfin servers'}
              </button>
              <p>
                Searches the OpenFlix server’s local network for about three seconds. A container or
                another subnet may hide servers; enter a URL manually if needed.
              </p>
            </>
          )}
          {discovery && (
            <div aria-label="Discovered Jellyfin servers">
              <p>
                Discovered names and addresses are unverified. Check the address before sending
                credentials.
              </p>
              {!discovery.candidates.length && (
                <p>
                  {discovery.unavailable
                    ? 'Discovery is unavailable on this network.'
                    : 'No matching servers found.'}{' '}
                  You can enter a URL below.
                </p>
              )}
              {discovery.candidates.map((candidate) => (
                <button
                  type="button"
                  key={candidate.baseUrl}
                  disabled={busy}
                  onClick={() => {
                    chooseAddress(candidate.baseUrl);
                    setName(candidate.name);
                  }}
                >
                  {candidate.name} · {candidate.baseUrl}
                </button>
              ))}
            </div>
          )}
          {canRegister && approved.length > 0 && (
            <details>
              <summary>Manage approved server identities</summary>
              <p>
                To replace a server at the same address, all users must disconnect it first.
                Forgetting the old identity lets an administrator verify and approve the
                replacement.
              </p>
              {approved.map((server) => (
                <div key={server.baseUrl}>
                  <p>
                    {server.name} · {server.baseUrl}
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={forget === server.baseUrl}
                      onChange={(event) => setForget(event.target.checked ? server.baseUrl : '')}
                    />{' '}
                    I confirm this old server identity should be forgotten.
                  </label>
                  <button
                    type="button"
                    disabled={busy || forget !== server.baseUrl}
                    onClick={async () => {
                      setBusy(true);
                      setMessage('');
                      try {
                        await connectorRequest('/approved-server', 'DELETE', {
                          baseUrl: server.baseUrl,
                          serverId: server.serverId,
                        });
                        if (!alive.current) return;
                        setApproved((current) =>
                          current.filter((item) => item.baseUrl !== server.baseUrl),
                        );
                        setForget('');
                        setMessage(
                          'Old server identity forgotten. Verify the replacement before connecting.',
                        );
                      } catch {
                        if (alive.current)
                          setMessage(
                            'Could not forget this identity. All users must disconnect this server first.',
                          );
                      } finally {
                        if (alive.current) setBusy(false);
                      }
                    }}
                  >
                    Forget old server identity
                  </button>
                </div>
              ))}
            </details>
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
            {canRegister ? (
              <input
                id="server-url"
                type="url"
                required
                maxLength={2048}
                placeholder="https://jellyfin.example"
                value={baseUrl}
                onChange={(e) => chooseAddress(e.target.value)}
                disabled={busy || !configured}
              />
            ) : (
              <select
                id="server-url"
                required
                value={baseUrl}
                disabled={busy || !configured}
                onChange={(e) => chooseAddress(e.target.value)}
              >
                <option value="">Choose an approved server</option>
                {approved.map((server) => (
                  <option key={server.baseUrl} value={server.baseUrl}>
                    {server.name} · {server.baseUrl}
                  </option>
                ))}
              </select>
            )}
            {!canRegister && approved.length === 0 && (
              <p>An administrator must approve a Jellyfin server address first.</p>
            )}
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
            <p>
              Credentials will be sent to:{' '}
              <strong>{baseUrl || 'Select or enter a server URL'}</strong>
            </p>
            <label className="server-confirmation">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy || !configured || !baseUrl}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I confirm this server address and authorize saving an encrypted personal Jellyfin
              session for my OpenFlix account.
            </label>
            <button disabled={busy || !configured || !confirmed}>
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
