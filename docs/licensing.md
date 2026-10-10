# License, legal notices and source availability

First-party OpenFlix is **GNU Affero General Public License version 3 only**, SPDX `AGPL-3.0-only`, with no custom exceptions or commercial restrictions. The complete [LICENSE](../LICENSE) is unmodified, including its explanatory sample appendix; that appendix's “or later” example does not change the version-3-only project grant in [NOTICE](../NOTICE) and package metadata. Contributions use the same license without copyright assignment. Third-party material retains its own [licenses and notices](../THIRD-PARTY-NOTICES.md). User media and unrelated metadata are not relicensed.

## Shipped interface

The footer exposes Source / License / Notices before and after login. Fixed public legal text assets are built from LICENSE, NOTICE and dependency notices; no runtime directory or arbitrary file-serving endpoint is added. The interface states there is no warranty and redistribution is permitted under the license.

Build-time `OPENFLIX_SOURCE_URL` identifies the corresponding source for the actual deployment. It must be an HTTPS URL without credentials, query or fragment. It is public metadata, never a secret. Without it the UI explicitly labels source identity unconfigured and asks the operator to supply the actual source; it does not claim that a moving branch or upstream release is the source of an unknown/dirty local build. Do not serve a modified deployment without making its actual corresponding source available and setting this link accordingly.

For an **unmodified checkout or extraction of the licensed release** `openflix-v0.5-m5`, use its immutable source asset:

```sh
export OPENFLIX_SOURCE_URL=https://github.com/MatthewVillnave/openflix/releases/download/openflix-v0.5-m5/openflix-v0.5-m5-source.zip
pnpm build
# Or, with the normal HTTPS origin/master-key configuration:
docker compose up --build -d --wait
```

The variable is consumed at build time; changing it requires rebuilding web assets. Production Compose forwards it only as a public build argument. Local `pnpm dev` reads it from the shell. A fork or modified checkout must use its own exact source offer, not the command above. The field is an operator attestation, not a cryptographic claim that the build is pristine. Keep the offered source accessible at no charge to remote users and recipients and include build/install scripts, lockfiles, notices and applicable dependency source. No source link downloads are made by the OpenFlix backend.

## Distribution and historical snapshots

The licensed release source ZIP and detached provenance record identify a new final commit, distinct from accepted M5 `e08d799de9accf84b50ab4d9334b5dc4b6d712ce`. Original audit archives remain byte-for-byte unchanged and did not contain the new license. [NOTICE](../NOTICE) records the owner's present grant over first-party M5 historical material within their authority; it does not relicense third-party material or pretend old archives contained this grant. Prefer the new self-contained licensed source package for distribution.

For executable/browser/container distributions, preserve notices and fulfill corresponding-source obligations for the exact code conveyed, including applicable non-system dependency source. For modified network deployments, AGPL section 13 requires a prominent opportunity for remote users to obtain the corresponding source. Merely linking upstream is insufficient when modifications are absent there. The fixed legal assets and configurable source offer support that duty; operators must provide the correct source and retain availability. This documentation is operational guidance, not a legal certification.
