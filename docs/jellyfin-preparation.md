# Jellyfin preparation for Milestone 2

Research only; no Jellyfin SDK is installed, no connector is implemented, and no live server was contacted or modified.

The [official TypeScript SDK documentation](https://typescript-sdk.jellyfin.org/) and the SDK repository's [OpenAPI artifact](https://media.githubusercontent.com/media/jellyfin/jellyfin-sdk-typescript/master/openapi.json) were inspected during the initial build on October 2, 2026. The repository stores its schema through Git LFS; the raw GitHub URL is only a pointer, not the schema.

The retrieved schema reported OpenAPI 3.0.4, Jellyfin API version **12.1.0**, and SHA-256 `6112f7aabd5960a9bf88382718e3804b09f6c92f39e06a49eea6d7524f7e51e6`. Inspected operation IDs included `GetPublicSystemInfo`, `AuthenticateUserByName`, `GetMediaFolders`, and `GetUserViews`. These observations are research, not a compatibility claim about the user's Ubuntu server. In particular, never choose a library endpoint solely because it appears in an SDK example: user-visible libraries and administrative media folders have different authorization implications.

Before implementation, re-fetch official documentation and the **version-matched** schema for the actual server. The SDK documentation has a compatibility matrix; select a supported SDK version after identifying the server version with the operator. Current upstream master may differ from the installed server.

Milestone 2 should implement only: add/test a Jellyfin connection, authenticate, enumerate authorized libraries, persist an encrypted connector credential, disconnect and reconnect. Keep generated DTOs and SDK calls inside `connector-jellyfin`. No frontend may receive permanent credentials. Use an authenticated encryption format with an external master key and per-record nonce, validate URLs and redirects against SSRF (with explicit support for intended private/LAN servers), bound timeouts and responses, and default every library to private. Initially test against controlled fixtures; use the actual OptiPlex only during later explicitly scoped integration testing without modifying Jellyfin.

Catalog sync is Milestone 3; playback is Milestone 4; multiple servers are Milestone 5; federation follows later.
