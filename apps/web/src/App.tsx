import { Catalog } from './Catalog.js';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CurrentUserResponse } from '@openflix/protocol';
import { MediaServers } from './MediaServers.js';
import { ApiError, currentUser, login, logout } from './api.js';
export function App() {
  const [settings, setSettings] = useState(false);
  const [user, setUser] = useState<CurrentUserResponse['user'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    let active = true;
    currentUser()
      .then((value) => {
        if (active) setUser(value.user);
      })
      .catch((error) => {
        if (active && !(error instanceof ApiError && error.status === 401))
          setError('The server is unavailable. Please try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function signIn(event: FormEvent) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      setUser((await login({ username, password })).user);
    } catch (error) {
      setError(
        error instanceof ApiError ? error.message : 'The server is unavailable. Please try again.',
      );
    } finally {
      setPassword('');
      setPending(false);
    }
  }
  async function signOut() {
    setError('');
    setPending(true);
    try {
      await logout();
      setUser(null);
      setSettings(false);
    } catch {
      setError('Could not sign out. Please try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="shell">
      <header>
        <a className="wordmark" href="/" aria-label="OpenFlix home">
          <span className="mark" aria-hidden="true">
            ▶
          </span>{' '}
          OPENFLIX
        </a>
        <span className="milestone">CATALOG / M3</span>
      </header>
      <main>
        <section className="intro">
          <p className="eyebrow">YOUR MEDIA. YOUR INFRASTRUCTURE.</p>
          <h1>
            A home for
            <br />
            what you love.
          </h1>
          <p className="lede">
            An independent home for your media libraries. <br />
            Built to connect. Designed to stay yours.
          </p>
          <div className="scope">
            <span className="dot" /> Milestone 3 · Catalog
          </div>
        </section>
        <section className="panel" aria-label={user ? 'Your account' : 'Sign in'}>
          {loading ? (
            <p role="status">Checking your session…</p>
          ) : user ? (
            <>
              <p className="eyebrow">CONNECTED TO OPENFLIX</p>
              <h2>Welcome, {user.displayName}.</h2>
              <p>Your account is ready.</p>
              <Catalog admin={user.role === 'admin'} />
              {user.role === 'admin' && (
                <>
                  <button className="secondary" onClick={() => setSettings((value) => !value)}>
                    Settings · Media Servers
                  </button>
                  {settings && <MediaServers />}
                </>
              )}
              <button className="secondary" onClick={signOut} disabled={pending}>
                {pending ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : (
            <>
              <p className="eyebrow">WELCOME BACK</p>
              <h2>Make yourself at home.</h2>
              <p>Sign in to your OpenFlix account.</p>
              <form onSubmit={signIn}>
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  name="username"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={64}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={pending}
                />
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={1024}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={pending}
                />
                <button disabled={pending}>
                  {pending ? 'Signing in…' : 'Sign in'}
                  <span aria-hidden="true">→</span>
                </button>
              </form>
              <p className="help">
                Need an account? Ask the operator of this OpenFlix installation.
              </p>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
      <footer>
        <span>Independent by design.</span>
        <span>OpenFlix · Milestone 3</span>
      </footer>
    </div>
  );
}
