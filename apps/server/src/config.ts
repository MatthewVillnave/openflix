import { isIP } from 'node:net';
import { resolve, join } from 'node:path';
import { z } from 'zod';
const integer = (fallback: number, min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))
    .default(fallback);
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  OPENFLIX_BASE_URL: z.url().default('http://localhost:5173'),
  OPENFLIX_HOST: z
    .string()
    .refine((value) => isIP(value) !== 0, 'must be an IP address')
    .default('127.0.0.1'),
  OPENFLIX_PORT: integer(8787, 1, 65535),
  OPENFLIX_MASTER_KEY: z.string().optional(),
  OPENFLIX_DATA_DIR: z.string().trim().min(1).default('.data'),
  OPENFLIX_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  OPENFLIX_SESSION_TTL_SECONDS: integer(86400, 300, 604800),
});
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid configuration fields: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  const value = parsed.data;
  const masterKey = value.OPENFLIX_MASTER_KEY || undefined;
  if (
    masterKey &&
    (Buffer.from(masterKey, 'base64').length !== 32 ||
      Buffer.from(masterKey, 'base64').toString('base64') !== masterKey)
  ) {
    throw new Error('OPENFLIX_MASTER_KEY must be canonical base64 encoding of 32 random bytes');
  }
  const url = new URL(value.OPENFLIX_BASE_URL);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'OPENFLIX_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment',
    );
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && (value.NODE_ENV === 'production' || !loopback)) {
    throw new Error('OPENFLIX_BASE_URL requires HTTPS except for local development');
  }
  if (value.NODE_ENV === 'production' && !env.OPENFLIX_BASE_URL)
    throw new Error('Production requires OPENFLIX_BASE_URL');
  const secureCookies = url.protocol === 'https:';
  return Object.freeze({
    masterKey,
    environment: value.NODE_ENV,
    origin: url.origin,
    host: value.OPENFLIX_HOST,
    port: value.OPENFLIX_PORT,
    databasePath: join(resolve(value.OPENFLIX_DATA_DIR), 'openflix.sqlite'),
    logLevel: value.OPENFLIX_LOG_LEVEL,
    sessionTtlSeconds: value.OPENFLIX_SESSION_TTL_SECONDS,
    secureCookies,
    cookieName: secureCookies ? '__Host-openflix_session' : 'openflix_session',
  });
}
export type Config = ReturnType<typeof loadConfig>;
