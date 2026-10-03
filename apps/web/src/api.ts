import type { CurrentUserResponse, LoginRequest } from '@openflix/protocol';
export class ApiError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? 'Invalid username or password.'
        : status === 429
          ? 'Too many attempts. Please wait a minute.'
          : 'Unable to complete the request. Please try again.',
    );
  }
}
async function request(path: string, body?: unknown) {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) throw new ApiError(response.status);
  return response;
}
export async function currentUser(): Promise<CurrentUserResponse> {
  return (await request('/me')).json();
}
export async function login(body: LoginRequest): Promise<CurrentUserResponse> {
  return (await request('/auth/login', body)).json();
}
export async function logout(): Promise<void> {
  await request('/auth/logout', {});
}
