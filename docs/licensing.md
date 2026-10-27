# License, legal notices and source availability

First-party OpenFlix is **GNU Affero General Public License version 3 only**, SPDX `AGPL-3.0-only`, with no custom exceptions or commercial restrictions. The complete [LICENSE](../LICENSE) is unmodified, including its explanatory sample appendix; that appendix's “or later” example does not change the version-3-only project grant in [NOTICE](../NOTICE) and package metadata. Contributions use the same license without copyright assignment. Third-party material retains its own [licenses and notices](../THIRD-PARTY-NOTICES.md). User media and unrelated metadata are not relicensed.

## Shipped interface

The footer exposes Source / License / Notices before and after login. Fixed public legal text assets are built from LICENSE, NOTICE and dependency notices; no runtime directory or arbitrary file-serving endpoint is added. The interface states there is no warranty and redistribution is permitted under the license.

Container builds also expose `/legal/openflix-source.tar.gz` through the footer. The archive is generated from the build context's allowlisted first-party source and build files, rather than a moving branch. It does not contain all third-party dependency sources, so its presence alone is not a complete corresponding-source offer for a distributed binary. Operators must arrange and retain applicable dependency sources and provide a complete offer for their actual build before distribution or modified network service.

The local candidate is accompanied separately by `openflix-third-party-material.tar.gz`, containing verified version-specific npm packages and selected upstream source archives. It is not automatically served by the container, and it is not a certified complete binary source bundle. Its manifest and [third-party review](../THIRD-PARTY-NOTICES.md) list the unresolved native-binary and OS-package source/build correspondence. Preserve it with the candidate and complete that review before publishing or offering binaries.

Build-time `OPENFLIX_SOURCE_URL` can identify that complete corresponding-source offer. It must be an HTTPS URL without credentials, query or fragment. It is public metadata, never a secret. Without it the UI explicitly labels the operator's complete source offer unconfigured; it does not claim that a moving branch or upstream release is the source of an unknown/dirty local build.

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
