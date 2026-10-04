# Milestone 1 verification

Verification environment: macOS Apple Silicon, Node 24.19.0, pnpm 11.19.0; Docker Desktop 4.93.0, Engine 29.8.1, Compose 5.5.1, Linux/ARM64. Audit-remediation verification: 2026-10-04. No Jellyfin server was used.

## Reproducible commands

```sh
pnpm install --frozen-lockfile
pnpm verify:docker
pnpm test
pnpm check
pnpm exec vitest run tests/database-permissions.test.ts tests/database.test.ts tests/cli.test.ts
pnpm audit --prod --json
pnpm audit --json
git diff --check
```

`pnpm check` includes formatting, a production build of every package/application, strict source/test type checks, and Vitest. Tests use native Argon2 and SQLite rather than substituting mock crypto or storage. Local socket permission is needed for lifecycle tests.

| Suite                                |  Tests | Coverage                                                                                                                                                            |
| ------------------------------------ | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/config.test.ts`               |     19 | Defaults, integer bounds, URL/origin restrictions, production HTTPS, safe errors                                                                                    |
| `tests/database.test.ts`             |      4 | Initialization/reopen, private files, migration idempotence/checksums/downgrade, rollback, foreign keys, uniqueness, parameterization                               |
| `tests/auth.test.ts`                 |      7 | Salted Argon2id/cost, verification failures, length limits, hashed persistent sessions, revocation, rotation, expiry, session cap, bounded password work            |
| `tests/http.test.ts`                 |     11 | Health, user lookup, login/logout, cookies, generic failure, CSRF, body/schema limits, rate limits, log non-disclosure, future routes absent                        |
| `tests/connector.test.ts`            |      2 | Compile-time normalized connector contract; explicit unavailable factory without credential reads or network calls                                                  |
| `tests/lifecycle.test.ts`            |      4 | Real listener/health/rebind, bind failure cleanup, compiled process SIGINT and SIGTERM                                                                              |
| `tests/cli.test.ts`                  |      2 | Root source-loader resolution and repeatable CLI migrations; noninteractive provisioning refusal                                                                    |
| `tests/web.test.tsx`                 |      3 | Sign-in/out flow, password clearing, auth failure, unavailable server                                                                                               |
| `tests/database-permissions.test.ts` |      8 | New/existing 0600, 0644 correction with data preservation, denied/ineffective chmod and descriptor cleanup, symlink/directory rejection, Windows fail-closed branch |
| **Total**                            | **60** | All passing in final verification                                                                                                                                   |

Production-only and full dependency audits reported zero known vulnerabilities at verification time. The lockfile was installed with `--frozen-lockfile` after the final dependency changes. Audits are point-in-time findings.

## Additional smoke checks

- The original macOS `pnpm deploy --legacy` smoke was insufficient: it could still resolve workspace packages through the checkout. A real Linux container exposed the broken deployment links. The corrected Docker build uses injected workspace dependencies and imports the deployed app with the source workspace temporarily moved away. Container startup now verifies the packaged native dependencies and application together.
- `OPENFLIX_DATA_DIR=/tmp/openflix-m1-ui-check pnpm dev` started the server and Vite. `pnpm user:create smoke` against that disposable directory succeeded through the actual masked terminal prompt.
- Browser verification through `http://localhost:5173`: account sign-in succeeded, session survived reload, logout succeeded, and reload returned to the login screen. The responsive layout was visually inspected. Test processes were stopped afterward; no sample account was placed in the normal runtime database.
- The first run exposed missing React test dependency/root `tsx` resolution and sandbox socket restrictions. Dependencies and CLI regression coverage were corrected, then the complete suite passed with local socket permission. These are resolved findings, not outstanding application failures.

## Docker verification

**2026-10-04 audit-remediation result: PASS — 13 check groups, exit 0.** Both production and development stacks ran successfully, including correction of the existing test database from 0644 to 0600 on production restart. The complete Linux suite passed 60/60 tests across 9 suites, plus builds, strict types and formatting. Trusted HTTPS browser checks used Chromium 154.0.8037.92. All disposable test containers and volumes were cleaned up. The separate host `pnpm test` and `pnpm check` runs also passed 60/60 tests across 9 suites. Both dependency audits reported zero known vulnerabilities.

Run the complete container suite from the repository root:

```sh
pnpm verify:docker
# Equivalent without local pnpm dependencies:
node scripts/verify-docker.mjs
```

Requires Docker with Compose, Node 24, free loopback ports 8080/5173, and network access to fetch images and packages. On macOS, Docker needs permission to read the repository's source directories for development bind mounts. If the repository is in Documents, approve the macOS Docker Documents-folder prompt. A pending prompt can leave containers in `Created` and block unrelated starts; it is not an application readiness failure. Do not disable macOS privacy protections.

The script selects unique Compose project names, refuses existing test resources, creates disposable accounts with random passwords, and removes only its test containers/networks/volumes in cleanup. It does not reuse the normal OpenFlix volume or contact Jellyfin. Image/build caches remain for subsequent runs. Build commands allow 20 minutes; other Docker commands are bounded at 3 minutes. No existing deployment should occupy the test ports.

The verification covers:

1. Validate both Compose files; build server, Nginx frontend and a separate browser-test image.
2. Start the full production stack with an empty named volume; assert migration version, zero users/sessions, SQLite integrity and mode 0600. Run migrations twice more and compare the ledger.
3. Check `/health`, HTML, compiled assets, API proxy, CSP, unauthenticated identity access and CSRF rejection.
4. Provision a disposable account, authenticate using native Argon2, inspect cookie flags and verify only the session digest is persisted.
5. Use Chromium over trusted HTTPS for sign-in, reload and logout; check HttpOnly/Secure/SameSite cookies, absent browser credential storage and absence of JavaScript errors. A temporary CA is trusted solely in the disposable container, never on the host. No certificate-validation bypass is used.
6. Inspect actual UIDs, effective capabilities, no-new-privileges, mounts, namespace settings, published ports and read-only production filesystems. Assert non-root, zero effective capabilities, no privileged mode, no Docker socket, loopback-only frontend and no published backend.
7. Change the disposable database to 0644, restart both containers, and assert mode 0600 is restored while the account, active session, migration ledger and private `/config` marker persist. Recheck mode after subsequent restart/replacement steps.
8. Stop cleanly; assert exit code 0 with no OOM kill; start again and repeat persistence checks.
9. Run Compose down/up without deleting the volume; assert replacement containers retain the same data and working session.
10. Revoke the session and scan collected production logs for errors, password/hash/token canaries and private-key material; validate structured safe events.
11. Build/start development Compose, reach Vite and proxied health, inspect development privileges and logs.
12. Run the entire `pnpm check` inside the Linux development image (60 tests, builds, type checks and formatting).
13. Remove the disposable test stacks and volumes; a cleanup failure makes the command fail.

The script emits 13 `PASS` check groups on a complete run; some related steps above share a group. CI invokes this same script. CI itself has not been dispatched remotely during this task. Operator-specific public TLS/DNS configuration remains a deployment responsibility; the browser fixture verifies the production authentication path over trusted HTTPS locally.

## Resolved findings

- Production deployment initially failed with `ERR_MODULE_NOT_FOUND` because legacy deployment linked workspace packages outside the final image. Fixed with pnpm injection, build synchronization and isolated deployment; added a source-removal import regression check in the Docker build.
- Excluded `.pnpm-store` and temporary `output` from the Docker context; the local cache had inflated the context to approximately 159 MB.
- Added capability dropping and no-new-privileges to development containers. Production already had these restrictions.
- Initial development startup waited on macOS Documents-folder permission before any process launched. The operator approved the prompt and the complete container suite then passed. This is a host permission prerequisite; no application workaround or weakened protection was added.

## Independent audit regression

The eight new permission tests were first run against the original implementation: five failed, including the exact 0644 reproduction (expected decimal 384/0600, received 420/0644). After remediation, the permission, database/migration and CLI suites passed all 14 tests. The new suite uses real files and SQLite; only the chmod system call is replaced for deterministic denial/no-op failures, independent of runner UID or mount behavior. Those tests assert no SQLite header/WAL/SHM is created and every attempted correction's descriptor is closed. The Windows branch is simulated on POSIX; this does not claim native Windows platform certification.
