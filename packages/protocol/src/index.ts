/** OpenFlix HTTP contracts only. Federation is intentionally unimplemented. */
import type { User } from '@openflix/shared';
export const API_PREFIX = '/api/v1' as const;
export interface CurrentUserResponse { user: User }
export interface LoginRequest { username: string; password: string }
export interface ErrorResponse { error: string }
export type HealthResponse = { status: 'healthy'; database: 'ok' } | { status: 'unhealthy'; database: 'unavailable' };
