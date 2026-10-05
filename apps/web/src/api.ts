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

export async function connectorRequest<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/connectors${path}`, {
    method,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    // Only present our fixed error vocabulary, never arbitrary upstream text.
    const data = await response.json().catch(() => ({}));
    const messages: Record<string, string> = {
      credential_unavailable:
        'Credential storage unavailable. Ask the operator to check the original master key.',
      unauthorized: 'Jellyfin rejected these credentials. Check the account and its access.',
      unsafe_redirect: 'Redirects are blocked. Enter the final Jellyfin base URL.',
      identity_mismatch: 'Server identity changed. Verify it before removing and adding again.',
      unsupported: 'This server version is unsupported. See the integration documentation.',
      invalid_configuration: 'Check the server URL and required fields.',
      unavailable: 'Jellyfin is unavailable. Check its address and network.',
      timeout: 'Jellyfin did not respond in time.',
      busy: 'Another connector operation is running. Retry shortly.',
    };
    throw new Error(messages[String(data.code)] ?? 'Could not complete the media server request.');
  }
  return response.json() as Promise<T>;
}
