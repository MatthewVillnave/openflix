import pino from 'pino';
import type { DestinationStream } from 'pino';
import type { Config } from './config.js';
export function createLogger(config: Config, destination?: DestinationStream) {
  return pino(
    {
      level: config.logLevel,
      base: { component: 'openflix-server' },
      redact: {
        paths: [
          'password',
          'passwordHash',
          'token',
          'secret',
          'privateKey',
          'credentials',
          'masterKey',
          'credentialEnvelope',
          'OPENFLIX_MASTER_KEY',
          'req.headers',
          'req.body',
          'res.headers',
        ],
        censor: '[REDACTED]',
      },
      // Only explicit safe metadata is logged. Never serialize raw errors, URLs or headers.
      serializers: {
        err: () => ({ message: 'Internal error' }),
        req: () => undefined,
        res: () => undefined,
      },
    },
    destination,
  );
}
