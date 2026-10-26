declare const __OPENFLIX_SOURCE_URL__: string | null;
declare const __OPENFLIX_BUNDLED_SOURCE__: boolean;
export function LegalNotice({
  source = typeof __OPENFLIX_SOURCE_URL__ === 'undefined' ? null : __OPENFLIX_SOURCE_URL__,
  bundled = typeof __OPENFLIX_BUNDLED_SOURCE__ !== 'undefined' && __OPENFLIX_BUNDLED_SOURCE__,
}: {
  source?: string | null;
  bundled?: boolean;
}) {
  return (
    <details>
      <summary>Source / License / Notices</summary>
      <p>
        OpenFlix · Copyright © 2026 Matthew Villnave and contributors. AGPL-3.0-only. No warranty.
        Redistribution is permitted under the license.
      </p>
      {bundled && (
        <p>
          <a href="/legal/openflix-source.tar.gz">OpenFlix source for this build</a>
        </p>
      )}
      <p>
        <a href="/legal/LICENSE.txt">License</a>
        {' · '}
        <a href="/legal/NOTICE.txt">Project notice</a>
        {' · '}
        <a href="/legal/THIRD-PARTY.txt">Third-party notices</a>
      </p>
      {source ? (
        <p>
          <a href={source}>Corresponding source (operator-provided for this build)</a>
        </p>
      ) : (
        <p>
          A complete corresponding-source offer is unconfigured. The operator must provide the
          actual corresponding source, including applicable third-party sources, before serving a
          modified deployment.
        </p>
      )}
    </details>
  );
}
