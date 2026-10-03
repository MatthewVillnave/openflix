import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { OpenFlixDatabase } from '@openflix/database';
import type { User } from '@openflix/shared';
import { hashPassword, verifyPassword } from './password.js';
export function tokenDigest(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function validToken(token: string | undefined): token is string { return !!token && /^[A-Za-z0-9_-]{43}$/.test(token); }
export const usernamePattern = /^[a-zA-Z0-9_.-]{3,64}$/;
export async function provisionUser(db: OpenFlixDatabase, username: string, password: string, role: User['role'] = 'user'): Promise<User> {
  if (!usernamePattern.test(username)) throw new Error('Username must contain 3–64 letters, numbers, dots, underscores or hyphens');
  const user: User = { id: randomUUID(), username: username.toLowerCase(), displayName: username, role };
  const passwordHash = await hashPassword(password);
  db.createUser({ ...user, passwordHash }, Date.now());
  return user;
}
export class AuthBusyError extends Error {}
export class AuthService {
  private activeVerifications = 0;
  private constructor(private readonly db: OpenFlixDatabase, private readonly ttlSeconds: number, private readonly dummyHash: string, private readonly now: () => number) {}
  static async create(db: OpenFlixDatabase, ttlSeconds: number, now: () => number = Date.now): Promise<AuthService> {
    return new AuthService(db, ttlSeconds, await hashPassword(randomBytes(32).toString('hex')), now);
  }
  async login(username: string, password: string, previousToken?: string): Promise<{user: User; token: string} | undefined> {
    if (this.activeVerifications >= 4) throw new AuthBusyError();
    this.activeVerifications++;
    try {
      const stored = this.db.findUser(username.toLowerCase());
      const valid = await verifyPassword(stored?.passwordHash ?? this.dummyHash, password);
      if (!stored || !valid) return undefined;
      const { passwordHash: _passwordHash, ...user } = stored;
      const token = randomBytes(32).toString('base64url');
      const now = this.now();
      this.db.createSession(tokenDigest(token), user.id, now, now + this.ttlSeconds * 1000, validToken(previousToken) ? tokenDigest(previousToken) : undefined);
      return { user, token };
    } finally { this.activeVerifications--; }
  }
  currentUser(token?: string): User | undefined { return validToken(token) ? this.db.sessionUser(tokenDigest(token), this.now()) : undefined; }
  logout(token?: string): void { if (validToken(token)) this.db.revokeSession(tokenDigest(token)); }
}
