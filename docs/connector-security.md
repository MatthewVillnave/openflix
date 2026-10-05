# Milestone 2 connector security and operations

## Administrator-trusted network boundary

Only authenticated OpenFlix administrators may list, add, test or remove media servers. Existing session cookies, CSRF Origin validation, body limits and rate limits remain active. The browser never calls Jellyfin directly and never receives a connector credential or encrypted envelope. All enumerated libraries remain administration-only metadata; no catalog or sharing API exists.

Administrators intentionally grant OpenFlix outbound access to the specified media server, including private IPv4/IPv6/LAN addresses. This is not an untrusted public URL-fetch service. A compromised administrator can direct these fixed Jellyfin operations at reachable HTTP(S) hosts; isolate the service/network accordingly. Server URLs must use explicit HTTP(S), contain no embedded credentials, whitespace, backslashes, query or fragment, and use literal safe base-path segments. Encoded separators and dot segments are refused. URLs are normalized once and cannot be edited in place; remove/re-add a changed endpoint.

The connector uses an isolated Axios 1.20.0 HTTP adapter through the official SDK: redirects are disabled, environment proxies are ignored, response bodies are capped at 1 MiB, outgoing bodies at 8 KiB, and each request has a five-second timeout plus absolute abort deadline. TLS verification is never disabled. Authenticated requests never follow a redirect to another origin. No discovery, automatic address probing or fallback protocol occurs. Unexpected statuses/JSON become fixed normalized errors; transport errors, request objects and upstream messages are never logged or returned.

HTTP is permitted for deliberate trusted-LAN deployments and the UI warns that it exposes credentials to network observers. Prefer HTTPS. DNS and the configured server/origin must remain trusted; there is no DNS pinning or protection against a malicious administrator/server. Public server identity is checked against the saved credential before token forwarding, but that check cannot replace TLS against an active network attacker. Untrusted server metadata is validated and displayed as React text, never HTML.

## Credential encryption

`OPENFLIX_MASTER_KEY` is an operator-provided, canonical base64 encoding of exactly **32 cryptographically random bytes**. It is not a human password. Generate it outside application logs, for example with `openssl rand -base64 32`, and provision it using protected operator configuration or a secret manager. There is no generated default or key stored in SQLite, its volume, an image or source control. `.env` is ignored; keep key-bearing files private and separate from database backups. Docker accepts the injected environment value; Docker/host administrators can inspect runtime environment and are trusted.

Encryption uses Node's `node:crypto` **AES-256-GCM**, with the 32-byte key directly, a fresh random 12-byte nonce per encryption, and a full 16-byte authentication tag. The JSON envelope stores `version=1`, `algorithm`, a non-secret SHA-256-derived key identifier, base64 nonce/tag/ciphertext. Authenticated additional data binds the envelope version, key identifier, connector ID, connector type and normalized base URL. Copying ciphertext to another identity or changing its origin fails authentication before any network request. Plaintext is not released before GCM tag verification.

Only the resulting user token and required user/server identifiers are encrypted. The Jellyfin password is used only for authentication and is never written to the database. Password form state and request-body references are cleared after use; mutable decrypted buffers and the vault key buffer on shutdown are overwritten. JavaScript strings/SDK copies are garbage-collected: this is not a guarantee of complete memory erasure. Remote token cleanup after failed setup is best effort; abrupt process termination can leave an upstream session requiring operator revocation.

Encryption protects credentials in an offline database-only disclosure. It does not protect a compromised running server/host, an attacker with the master key, old plaintext copies, or database metadata such as server address/name/library names. SQLite primary and auxiliary files can contain sensitive data even with encrypted tokens. All audited R2 ownership, private-directory, ancestor and file/sidecar protections remain unchanged.

## Missing keys, restart and rotation

With no key and no saved connectors, the foundation starts and administration reports credential storage unavailable; adding connectors fails closed. Malformed configured keys fail validation without echoing their value. If saved connectors exist, missing/wrong keys or tampered envelopes fail startup before any upstream request. Recover the original key; OpenFlix does not silently discard records or authenticate again using a stored password.

After a normal restart, saved connections are marked **unverified**. An administrator uses **Reconnect / test** to validate the server/user and refresh accessible libraries with the saved encrypted token, without entering a password. Startup performs local credential authentication only; it does not contact every configured LAN host or claim stale connection state is live.

The envelope version and key identifier reserve a future reviewed migration/rotation path. Automated rotation/key rings are not implemented. Simply changing the master key will not rotate existing records and causes startup to fail. Keep protected backups of the original key separately from ciphertext. If the key is lost, credentials are unrecoverable: an operator must stop OpenFlix, back up the database, remove the affected connector records with an offline database tool, and re-add connections with a new key. Revoke old OpenFlix sessions in Jellyfin independently where possible. Never modify the authentication/session tables to bypass access controls.

## Removal and bounded operations

Disconnect/remove tries `ReportSessionEnded` for this connector's token, then deletes the local connector row/encrypted credential. HTTP 401 at logout means the token is already invalid. When offline, identity changes or revocation fails, local removal still succeeds but explicitly reports **unconfirmed** remote revocation; the UI tells the administrator to revoke that session in Jellyfin later. Other Jellyfin sessions/libraries/media are not changed.

There is one connector mutation in flight per server process and a limit of ten configuration records. This bounds operator-triggered work without background queues. The limit is not catalog aggregation or multiple-source selection. Each operation comprises a bounded number of five-second requests. Request bodies are limited by the existing global 8 KiB cap, and add attempts have a 10/minute route limit. No tokens, passwords, ciphertext envelopes, encryption keys, raw URLs or SDK exceptions enter application logs.

Stop the service before backup/restore. Preserve original data ownership and the separate master key; restored primary/WAL/SHM permissions are re-established by R2 storage enforcement. Do not weaken runtime UID, capabilities or private-directory checks for a host volume.
