# Explicit Jellyfin discovery and connection selection

This uncommitted follow-up builds on local UX checkpoint
`06736fac46d1d88370c99928c30763f2d089c5b1`. It does not connect a household server,
create a Jellyfin account/token, change network settings, or connect any real household identity.

## Personal identity model

The later user decision supersedes the original shared-connector model. OpenFlix accounts
remain separate from Jellyfin accounts. Each person links their own Jellyfin identity;
only that OpenFlix account can access its saved token and indexed catalog. Administrators
approve server destinations, but cannot access another person's connection. See
[the personal identity plan](personal-jellyfin-plan.md) for migration, isolation, cache
freshness and validation limits. Existing shared connectors are preserved and quarantined.

## Implemented flow

Settings has an explicit Find Jellyfin servers action. The authenticated, admin-only,
same-origin POST endpoint permits two requests/minute and one active search. It sends
one `Who is JellyfinServer?` datagram to UDP 7359 on each eligible RFC1918 IPv4 interface
(up to eight), using its directed broadcast address. No individual host/port scan,
HTTP probe, DNS lookup, credentials, or automatic authentication is performed.

Search lasts 2.5 seconds, processes at most 128 packets, and returns at most 16 unique
addresses. Packets over 2 KiB, nonlocal/wrong-port responses, malformed identities,
unsafe URLs, and advertised hosts differing from their sender IP are rejected. Only
sender-owned literal IPv4 addresses are offered: public/DNS/reverse-proxy/IPv6 addresses
remain manual URL entries. This conservative rule is not cryptographic authentication:
LAN attackers can spoof discovery. Names are rendered as text, never HTML. The user
must verify the visible destination, then explicitly confirm personal-session storage
before submitting credentials. Selection alone makes no authentication request.
Changing the URL clears the password and confirmation. Discovery aborts on component
unmount; the server discards late results after logout and closes sockets on timeout,
error, cancellation, or shutdown. Responses are not cached or persisted.

Manual URL setup preserves the existing administrator-trusted destination policy. It
is not a general SSRF-safe public endpoint: an authenticated administrator is deliberately
allowed to configure private/loopback servers. Existing URL syntax checks, disabled HTTP
redirects/proxy environment inheritance, bounded requests, upstream identity checks,
encrypted token storage, secret redaction and best-effort new-token cleanup remain.
Discovery must never turn its untrusted reply into an automatic credential destination.

## Network and operational limits

A normal web page cannot use raw UDP discovery. Search therefore originates from the
OpenFlix backend, not the phone/browser's Wi-Fi. Docker bridge/rootless/container and
subnet boundaries can prevent discovery. Empty results do not prove Jellyfin is absent.
No host networking, firewall rules, port mappings, certificate bypass, or persistent
access changes are included. The existing synthetic preview disables connector writes
and is not a place to enter real credentials. Household login requires a separately
approved secure UI instance and storage configuration; do not send passwords in chat.
No household playback is authorized without a title and watch-state acknowledgement.

## Official references checked 2026-10-26

- [Jellyfin networking](https://jellyfin.org/docs/general/post-install/networking/):
  UDP 7359, local-subnet discovery and HTTP(S) access.
- [Official AutoDiscoveryHost](https://github.com/jellyfin/jellyfin/blob/master/src/Jellyfin.Networking/AutoDiscoveryHost.cs):
  exact query and JSON discovery response.
- [Official UserController](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/UserController.cs):
  `POST /Users/AuthenticateByName` authenticates a new user session.

Validation uses synthetic sockets, addresses, credentials and disposable HTTP fixtures.
Actual household LAN discovery/login remains unrun. The pre-existing mock expiry is
unchanged; source code remains on the feature branch without push/deployment.
