# OpenFlix

OpenFlix is an independent, self-hosted web media client and account/connector API. It connects to an existing Jellyfin server; it does not bundle a Jellyfin server or anyone's media. This unreleased branch adds a dark artwork-led Home with burnt-orange accents, movie and series details, hierarchical Back, automatic initial library loading, and personal Jellyfin identities for each OpenFlix account.

Plex, Emby, Screenroom and Live TV are possible future integrations, not working features in this candidate. The prior M5 release and its historical acceptance are separate from the uncommitted work on this branch. The branch is a packaging candidate, not a published release.

## Start locally

See [the self-hosted candidate guide](docs/self-hosted-candidate.md) for prerequisites, a private master key, first-run setup, additional-user provisioning, start/stop, updates, backup and uninstall. Its Docker Compose configuration binds the browser interface to `127.0.0.1:8080` and stores data in a named volume outside the code. Docker and Jellyfin must already be installed separately. The first OpenFlix account created on an empty installation is the administrator; set it up before exposing the service. Each user subsequently connects their own Jellyfin login.

Additional users are currently provisioned by an interactive operator command; open signup and invitation management are not implemented. Signing out does not disconnect the saved personal Jellyfin connection. The encryption key must remain private and be backed up separately from the database; replacing it makes saved connection credentials unavailable.

For network use, the existing `docker-compose.yml` expects an independently configured HTTPS origin and reverse proxy. Local HTTP and discovery are not a substitute for secure remote access. See [configuration](docs/configuration.md) and [security](docs/security.md).

## What is supported

Home, Movies and TV Shows use permitted Jellyfin catalog content. Details lead to the existing authenticated player. Supported direct or Jellyfin-managed HLS paths are bounded by the media, server and browser; HDR sources may require Jellyfin conversion to SDR. Source-specific resume and progress can update the linked Jellyfin account. Subtitle rendering, alternate tracks, all codecs, unrestricted 4K, DRM, live TV and seamless midstream fallback are not established. See [playback scope](docs/playback-scope.md).

Validation has included disposable real Jellyfin 10.11.11 with generated movie and episode media in Chromium, two-user isolation, and limited user-directed household playback. This is not sustained performance testing or proof of compatibility with every Jellyfin version, browser or device. Firefox, iPhone, TV devices, native installer packages and large-scale usage remain unverified for this candidate.

## Develop and verify

Node 24.19.0 and pnpm 11.19.0 are pinned. From a complete checkout, run `pnpm install --frozen-lockfile`, configure a private `OPENFLIX_MASTER_KEY` as described in [configuration](docs/configuration.md), then `pnpm build` and `pnpm dev`. `pnpm check` runs formatting, builds, types and tests; isolated integration tests may require loopback sockets. The source candidate is not a published binary and needs its dependencies installed when built.

## License and provenance

First-party OpenFlix is **AGPL-3.0-only**. See [LICENSE](LICENSE), [NOTICE](NOTICE), [third-party notices](THIRD-PARTY-NOTICES.md) and [source-availability guidance](docs/licensing.md). The separately installed Jellyfin TypeScript SDK remains MPL-2.0; HLS.js is Apache-2.0. Their terms and notices remain applicable. Jellyfin is an independent server accessed over its API and is not included in the candidate. Connecting to it does not transfer ownership of that server or media to OpenFlix.

Container builds offer their exact packaged first-party source in the footer. That archive does not include all third-party dependency sources: a distributed or modified network-served build also needs an appropriate complete corresponding-source offer. Do not point it to an older release that omits this branch's changes. The inventory is engineering guidance, not a legal clearance of every dependency, container image, patent or media right.
