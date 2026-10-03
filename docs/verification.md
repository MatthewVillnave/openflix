# Milestone 1 verification

Verified on the initial macOS Apple Silicon environment with Node 24.19.0 and pnpm 11.19.0. No Jellyfin server was used.

## Reproducible commands

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm audit --prod --json
pnpm audit --json
git diff --check
```

`pnpm check` includes formatting, a production build of every package/application, strict source/test type checks, and Vitest. Tests use native Argon2 and SQLite rather than substituting mock crypto or storage. Local socket permission is needed for lifecycle tests.

| Suite                     |  Tests | Coverage                                                                                                                                                 |
| ------------------------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/config.test.ts`    |     19 | Defaults, integer bounds, URL/origin restrictions, production HTTPS, safe errors                                                                         |
| `tests/database.test.ts`  |      4 | Initialization/reopen, private files, migration idempotence/checksums/downgrade, rollback, foreign keys, uniqueness, parameterization                    |
| `tests/auth.test.ts`      |      7 | Salted Argon2id/cost, verification failures, length limits, hashed persistent sessions, revocation, rotation, expiry, session cap, bounded password work |
| `tests/http.test.ts`      |     11 | Health, user lookup, login/logout, cookies, generic failure, CSRF, body/schema limits, rate limits, log non-disclosure, future routes absent             |
| `tests/connector.test.ts` |      2 | Compile-time normalized connector contract; explicit unavailable factory without credential reads or network calls                                       |
| `tests/lifecycle.test.ts` |      4 | Real listener/health/rebind, bind failure cleanup, compiled process SIGINT and SIGTERM                                                                   |
| `tests/cli.test.ts`       |      2 | Root source-loader resolution and repeatable CLI migrations; noninteractive provisioning refusal                                                         |
| `tests/web.test.tsx`      |      3 | Sign-in/out flow, password clearing, auth failure, unavailable server                                                                                    |
| **Total**                 | **52** | All passing in final verification                                                                                                                        |

Production-only and full dependency audits reported zero known vulnerabilities at verification time. The lockfile was installed with `--frozen-lockfile` after the final dependency changes. Audits are point-in-time findings.

## Additional smoke checks

- `pnpm --filter @openflix/server deploy --prod --legacy /tmp/openflix-m1-deploy` produced a standalone production dependency tree. Running its `dist/cli.js db:migrate` succeeded; its `buildApp` served `/health` with 200 and `{"status":"healthy","database":"ok"}`. This validates packaging on macOS, not Linux container execution.
- `OPENFLIX_DATA_DIR=/tmp/openflix-m1-ui-check pnpm dev` started the server and Vite. `pnpm user:create smoke` against that disposable directory succeeded through the actual masked terminal prompt.
- Browser verification through `http://localhost:5173`: account sign-in succeeded, session survived reload, logout succeeded, and reload returned to the login screen. The responsive layout was visually inspected. Test processes were stopped afterward; no sample account was placed in the normal runtime database.
- The first run exposed missing React test dependency/root `tsx` resolution and sandbox socket restrictions. Dependencies and CLI regression coverage were corrected, then the complete suite passed with local socket permission. These are resolved findings, not outstanding application failures.

## Docker verification gap

No Docker CLI or daemon was available on this MacBook. Docker images, Compose startup, Linux native dependencies, Nginx configuration and container volume behavior were **not executed locally**. The production package smoke check does not replace them.

On a Docker-capable machine, run:

```sh
OPENFLIX_BASE_URL=https://openflix.example docker compose config --quiet
docker compose -f docker/compose.dev.yml config --quiet
OPENFLIX_BASE_URL=https://openflix.example docker compose up --build --wait
curl --fail http://127.0.0.1:8080/health
# Also verify actual browser authentication behind the intended HTTPS proxy.
```

The repository's CI workflow automates production image build, Compose health, static web/API proxy checks, CSP presence, unauthorized identity access, CSRF rejection and database restart readiness. That workflow has been authored but not run remotely during this task. Docker validation must pass before marking the whole milestone PASS or beginning Milestone 2.
