# Jellyfin API baseline for Milestone 2

Inspected on 2026-10-05 UTC before connector implementation. No household Jellyfin instance was contacted. This is a builder-side protocol baseline; Optimus must verify the actual OptiPlex server version and behavior before acceptance.

## Official sources and immutable revisions

- [Official TypeScript SDK documentation](https://typescript-sdk.jellyfin.org/): compatibility matrix lists SDK 1.0.0 for Jellyfin 12.x, and SDK 0.13.0 for 10.11.x. The example administrative media-folder enumeration is not our authorization model.
- [SDK 1.0.0 source](https://github.com/jellyfin/jellyfin-sdk-typescript/tree/1fdc2aefcf963fec84e7eafe15743dafe8c1d26a), tag `v1.0.0`, commit `1fdc2aefcf963fec84e7eafe15743dafe8c1d26a`. Installed dependency: **@jellyfin/sdk 1.0.0**. Its matched schema is Jellyfin **12.0.0**, SHA-256 `ad67dfca28a6c587fb475f9c12909ab611435d344c197d9c45dac4c44741d50e`.
- [Current upstream SDK revision](https://github.com/jellyfin/jellyfin-sdk-typescript/tree/1ef06252cef5d1729646331e64059e230f11a08b), commit `1ef06252cef5d1729646331e64059e230f11a08b`: OpenAPI **3.0.4**, Jellyfin API **12.1.0**, SHA-256 `6112f7aabd5960a9bf88382718e3804b09f6c92f39e06a49eea6d7524f7e51e6`. Official server latest-release metadata reported tag `v12.1`, published 2026-09-15.
- [SDK 0.13.0 source](https://github.com/jellyfin/jellyfin-sdk-typescript/tree/94695753de92d3777f8b7f07960d0b7b145fa67e), commit `94695753de92d3777f8b7f07960d0b7b145fa67e`: matched API **10.11.1**, SHA-256 `0047c300a9ec8fbccd301d388ef21bfb1cfc7a9ba96e3018a45e366cff4981c3`.
- Schemas were retrieved from official Git LFS media URLs, e.g. `https://media.githubusercontent.com/media/jellyfin/jellyfin-sdk-typescript/<commit>/openapi.json`. The raw repository file is an LFS pointer. The API explorer at `api.jellyfin.org` returned HTTP 403; the matching official SDK schema artifacts were inspected directly instead.

The required wire operations and relevant DTO fields match across the inspected 12.0, 12.1 and 10.11.1 schemas. Runtime accepts 12.x and 10.11.x; fixtures cover 12.0.0, 12.1.0 and 10.11.1. SDK 1.0.0 is officially advertised for 12.x: using its inspected compatible subset with 10.11.x is a limited wire-compatibility choice, **not** a claim of SDK-wide or real-server 10.11 compatibility. Other versions fail explicitly. Optimus must test the actual server and report any unsupported version rather than upgrading production merely to fit the builder.

## Operations actually used

| Operation                | Method/path                      | Purpose                                                                                  |
| ------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `GetPublicSystemInfo`    | `GET /System/Info/Public`        | Bounded reachability, ID/name/version; identity check before forwarding saved credential |
| `AuthenticateUserByName` | `POST /Users/AuthenticateByName` | Username plus `Pw`; obtain user-scoped access token, user ID and server ID               |
| `GetCurrentUser`         | `GET /Users/Me`                  | Confirm saved token and user identity                                                    |
| `GetUserViews`           | `GET /UserViews`                 | Explicit authenticated `userId`, `includeHidden=false`, `includeExternalContent=false`   |
| `ReportSessionEnded`     | `POST /Sessions/Logout`          | Revoke/end this connector's user session where supported                                 |

Use the SDK's current authentication and session helpers, which update its token state. Authorization is the SDK-generated `MediaBrowser` header. Do not copy SDK example console logging of authentication responses. The implementation uses the explicit `lib/jellyfin.js` entrypoint and `.js` helper paths because the SDK's root declaration re-exports omit extensions under NodeNext; runtime SDK calls remain unchanged.

Generated DTOs, PascalCase fields, token serialization and upstream errors stay inside `packages/connector-jellyfin`. Zod validates every consumed response before normalization. Libraries are the connector user's accessible views, not administrator-wide `GetMediaFolders`. No catalog items, artwork, playback URLs, media changes or federation calls are made.

## Verification boundary

`tests/jellyfin-fixture.ts` and `docker/jellyfin-fixture.mjs` implement only these inspected operations with disposable credentials. The Docker fixture persists session digests in its own disposable volume solely to model a separately persistent upstream across stack recreation. It is not included in ordinary production Compose. Mocks/fixtures are not a real Jellyfin acceptance result. Follow [Optimus integration checks](milestone-2-integration.md).
