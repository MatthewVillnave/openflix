import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../packages/database/dist/index.js';
import { AuthService, AuthBusyError, provisionUser, tokenDigest } from '../apps/server/src/auth.js';
import { hashPassword, verifyPassword } from '../apps/server/src/password.js';
import { temporaryConfig, testPassword } from './helpers.js';
describe('password storage', () => {
  it('uses salted Argon2id with configured cost and verifies success/failure', async () => {
    const first = await hashPassword(testPassword); const second = await hashPassword(testPassword);
    expect(first).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(first).not.toEqual(second); expect(first).not.toContain(testPassword);
    expect(await verifyPassword(first, testPassword)).toBe(true);
    expect(await verifyPassword(first, 'wrong')).toBe(false);
    expect(await verifyPassword('corrupt-hash', testPassword)).toBe(false);
  });
  it('enforces length and UTF-8 byte limits', async () => {
    await expect(hashPassword('short')).rejects.toThrow();
    await expect(hashPassword('🔑'.repeat(300))).rejects.toThrow();
  });
});
describe('authentication and revocable sessions', () => {
  let fixture: ReturnType<typeof temporaryConfig>;
  let db: ReturnType<typeof openDatabase>;
  let auth: AuthService;
  let now: number;
  beforeEach(async () => { fixture = temporaryConfig(); db = openDatabase(fixture.config.databasePath); now = 1000; await provisionUser(db, 'alice', testPassword); auth = await AuthService.create(db, 300, () => now); });
  afterEach(() => { db.close(); fixture.cleanup(); });
  it('authenticates, stores only digests, persists sessions across reopen, and revokes', async () => {
    const result = (await auth.login('ALICE', testPassword))!;
    expect(result.user).not.toHaveProperty('passwordHash'); expect(result.token).toHaveLength(43);
    const raw = new Database(fixture.config.databasePath);
    const session = raw.prepare('SELECT token_hash FROM user_sessions').get(); raw.close();
    expect(session).toEqual({ token_hash: tokenDigest(result.token) });
    expect(JSON.stringify(session)).not.toContain(result.token);
    db.close(); db = openDatabase(fixture.config.databasePath); auth = await AuthService.create(db, 300, () => now);
    expect(auth.currentUser(result.token)?.username).toBe('alice');
    auth.logout(result.token); expect(auth.currentUser(result.token)).toBeUndefined();
  });
  it('fails generically for wrong and unknown credentials and creates no session', async () => {
    expect(await auth.login('alice', 'wrong')).toBeUndefined();
    expect(await auth.login('nobody', testPassword)).toBeUndefined();
    const raw = new Database(fixture.config.databasePath);
    expect(raw.prepare('SELECT count(*) AS n FROM user_sessions').get()).toEqual({ n: 0 }); raw.close();
  });
  it('rejects expired and malformed tokens, rotates on login, and caps stored sessions', async () => {
    const first = (await auth.login('alice', testPassword))!;
    const second = (await auth.login('alice', testPassword, first.token))!;
    expect(first.token).not.toBe(second.token); expect(auth.currentUser(first.token)).toBeUndefined();
    expect(auth.currentUser('forged')).toBeUndefined();
    for (let i = 0; i < 12; i++) db.createSession(tokenDigest(`token-${i}`), second.user.id, now + i, now + 300000);
    const raw = new Database(fixture.config.databasePath);
    expect(raw.prepare('SELECT count(*) AS n FROM user_sessions').get()).toEqual({ n: 10 }); raw.close();
    now += 300000; expect(auth.currentUser(second.token)).toBeUndefined();
  });
  it('expires exactly at the deadline', async () => {
    const result = (await auth.login('alice', testPassword))!;
    now = 300999; expect(auth.currentUser(result.token)).toBeDefined();
    now = 301000; expect(auth.currentUser(result.token)).toBeUndefined();
  });
  it('bounds expensive concurrent password work', async () => {
    const attempts = Array.from({length: 5}, () => auth.login('nobody', 'wrong'));
    const results = await Promise.allSettled(attempts);
    expect(results.filter(result => result.status === 'rejected' && result.reason instanceof AuthBusyError)).toHaveLength(1);
  });
});
