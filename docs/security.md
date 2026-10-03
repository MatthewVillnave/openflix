# Milestone 1 security assumptions

## Trust boundary

The operator controls the host, executable code, database volume and reverse proxy. Internet clients and browser input are untrusted. Host/root compromise, malicious browser extensions and compromised TLS terminators are outside this milestone's protection. SQLite is local to one server process; there is no distributed session or rate-limit service.

The application never accesses the user's live Jellyfin server. There are no network connector endpoints, outbound URL fetches, stored connector secrets, peer inputs or media capabilities yet. SSRF defense, authenticated connector encryption, key rotation and library permission enforcement are required before Milestone 2 exposes connector management. Federation signatures and replay protection are deferred with federation itself, not simulated.

## Authentication

- Passwords use Argon2id v19 with 64 MiB, 3 iterations, parallelism 1, generated random salts and a 32-byte hash. This exceeds the current [OWASP minimum](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Password input is 12+ characters and at most 1024 UTF-8 bytes when provisioned; login accepts existing passwords within the byte limit.
- Passwords enter account provisioning through a hidden, confirmed terminal prompt, not command-line arguments, committed files or environment defaults. There is no public registration, default user, default production password or bypass flag.
- Unknown users still undergo password verification against a randomly generated dummy hash. Invalid credentials return the same error. This reduces obvious timing disclosure without claiming perfect constant-time account lookup.
- Sessions use 256 random bits encoded as base64url. Only a SHA-256 digest is stored. These are high-entropy tokens, not passwords, so fast hashing is appropriate. Database read access alone does not reveal usable session tokens; write access still compromises identity.
- Sessions are absolute-lived, revocable and rotated at login. The browser receives only a safe user projection, never a password hash or a bearer token in JSON.
- HTTPS uses `__Host-openflix_session`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no Domain. Explicit loopback development uses an unprefixed non-Secure cookie so local HTTP is usable. Production cannot disable Secure cookies.

## HTTP and logging

- All mutating requests, including login/logout, require an exact match between `Origin` and configured public origin. Missing and `null` origins fail closed. This is the CSRF defense, reinforced by SameSite cookies. Non-browser clients must send the configured Origin explicitly; Origin is not itself an authentication credential.
- There is no cross-origin API access and no permissive CORS handler. A same-origin web/proxy topology removes the need for an allowlist of remote browser origins.
- Body size is limited to 8 KiB; login JSON has strict types, length limits and no additional properties. Request/connection timeouts, rate limits and a four-verification concurrency cap bound basic resource use. Edge-level DoS mitigation is still necessary for public deployment.
- Helmet sets security headers. The production web server supplies a CSP without inline scripts/styles, same-origin script/style/connect rules, no objects or framing, and same-origin forms. TLS/HSTS for the public web origin belongs to the outer HTTPS proxy. Vite is a development tool and is not a production server.
- API responses use `Cache-Control: no-store`. The web does not persist credentials or session tokens in localStorage.
- Structured Pino logging records generated request IDs, route templates, status, safe events and user IDs. It deliberately omits request bodies, raw URLs, headers, cookies and arbitrary error text. Redaction and serializers provide defense in depth. Nginx request/error logging is disabled because raw URLs can eventually contain capabilities; server logs remain the diagnostic source. Do not configure an outer proxy to log cookies, request bodies, authorization headers or sensitive query strings.
- SQL values are bound parameters. Schema SQL is static and migrations run transactionally. There is no arbitrary SQL API.

## Remaining work

This is a foundation, not a complete internet-facing media product. Password reset/change, MFA, passkeys, account administration, role enforcement for future privileged endpoints, durable audit records, account-scoped abuse limits, encrypted connector storage and key recovery are unimplemented. There are no administrator HTTP endpoints yet. Operators can revoke all sessions by stopping the service and removing session rows with an appropriate local database tool; no remote reset shortcut is provided.

Do not commit `.env`, databases, keys, tokens or dependencies. Unit-test credentials are test-only values used exclusively in disposable databases; the Docker verifier generates random, ephemeral passwords. Its HTTPS fixture trusts a temporary CA only inside the disposable browser container. Chromium's OS sandbox is disabled only for that non-root, capability-restricted test container; production images contain no browser or CA material. Dependency audits are point-in-time checks, not a security guarantee. Images/dependencies require regular update review; Docker image versions are pinned by release tag, not immutable digest.
