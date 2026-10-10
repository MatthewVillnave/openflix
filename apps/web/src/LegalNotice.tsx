declare const __OPENFLIX_SOURCE_URL__: string | null;
export function LegalNotice({
  source = typeof __OPENFLIX_SOURCE_URL__ === 'undefined' ? null : __OPENFLIX_SOURCE_URL__,
}: {
  source?: string | null;
}) {
  return (
    <details>
      <summary>Source / License / Notices</summary>
      <p>
        OpenFlix · Copyright © 2026 Matthew Villnave and contributors. AGPL-3.0-only. No warranty.
        Redistribution is permitted under the license.
      </p>
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
          Source identity is unconfigured for this build. The operator must provide its actual
          corresponding source before serving a modified deployment.
        </p>
      )}
    </details>
  );
}
