import { Cinema } from './Home.js';
import { LegalNotice } from './LegalNotice.js';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CurrentUserResponse } from '@openflix/protocol';
import { ApiError, createOwner, currentUser, login, logout, setupStatus } from './api.js';
export function App() {
  const [user, setUser] = useState<CurrentUserResponse['user'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    let active = true;
    currentUser()
      .then((value) => {
        if (active) setUser(value.user);
      })
      .catch(async (error) => {
        if (error instanceof ApiError && error.status === 401) {
          try {
            const status = await setupStatus();
            if (active) setSetup(status.setupRequired === true);
          } catch (setupError) {
            if (active && !(setupError instanceof ApiError && setupError.status === 404))
              setError('The server is unavailable. Please try again.');
          }
        } else if (active) setError('The server is unavailable. Please try again.');
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
      if (setup) {
        await createOwner({ username, password });
        setSetup(false);
      }
      setUser((await login({ username, password })).user);
    } catch (error) {
      if (setup && error instanceof ApiError && error.status === 409) {
        setSetup(false);
        setError('An account was already created. Sign in instead.');
      } else
        setError(
          error instanceof ApiError
            ? error.message
            : 'The server is unavailable. Please try again.',
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
    } catch {
      setError('Could not sign out. Please try again.');
    } finally {
      setPending(false);
    }
  }
  if (user)
    return (
      <Cinema
        key={user.id}
        user={user}
        pending={pending}
        error={error}
        onSignOut={() => void signOut()}
      />
    );
  return (
    <div className="shell">
      <header>
        <a className="wordmark" href="/" aria-label="OpenFlix home">
          <span className="mark" aria-hidden="true">
            ▶
          </span>{' '}
          OPENFLIX
        </a>
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
        </section>
        <section className="panel" aria-label={setup ? 'Create your account' : 'Sign in'}>
          {loading ? (
            <p role="status">Checking your session…</p>
          ) : (
            <>
              <p className="eyebrow">{setup ? 'GET STARTED' : 'WELCOME BACK'}</p>
              <h2>{setup ? 'Create your account.' : 'Make yourself at home.'}</h2>
              <p>
                {setup
                  ? 'This first OpenFlix account is the administrator of this installation. Connect your personal Jellyfin account after signing in.'
                  : 'Sign in to your OpenFlix account.'}
              </p>
              <form onSubmit={signIn}>
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  name="username"
                  autoComplete="username"
                  required
                  minLength={3}
                  pattern="[a-zA-Z0-9_.-]+"
                  maxLength={64}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={pending}
                />
                <label htmlFor="password">Password</label>
                {setup && <p className="help">Use at least 12 characters.</p>}
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={setup ? 'new-password' : 'current-password'}
                  required
                  minLength={setup ? 12 : 1}
                  maxLength={1024}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={pending}
                />
                <button disabled={pending}>
                  {pending
                    ? setup
                      ? 'Creating account…'
                      : 'Signing in…'
                    : setup
                      ? 'Create account'
                      : 'Sign in'}
                  <span aria-hidden="true">→</span>
                </button>
              </form>
              {!setup && (
                <p className="help">
                  Need an account? Ask the operator of this OpenFlix installation.
                </p>
              )}
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
        <LegalNotice />
      </footer>
    </div>
  );
}
