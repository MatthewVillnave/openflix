// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LegalNotice } from '../apps/web/src/LegalNotice.js';
import { legalAssets, sourceUrl } from '../scripts/legal-assets.js';

afterEach(cleanup);
it('offers legal notices without login and never labels an unknown build as the release', () => {
  render(<LegalNotice />);
  fireEvent.click(screen.getByText('Source / License / Notices'));
  expect(screen.getByText(/Source identity is unconfigured/)).toBeDefined();
  expect(screen.queryByText(/Corresponding source \(/)).toBeNull();
  expect(screen.getByRole('link', { name: 'License' }).getAttribute('href')).toBe(
    '/legal/LICENSE.txt',
  );
  expect(screen.getByText(/No warranty/)).toBeDefined();
});
it('offers only the explicitly configured corresponding source', () => {
  const source = sourceUrl('https://example.org/releases/exact-version-source.zip');
  render(<LegalNotice source={source} />);
  fireEvent.click(screen.getByText('Source / License / Notices'));
  expect(screen.getByRole('link', { name: /Corresponding source/ }).getAttribute('href')).toBe(
    source,
  );
});
it('rejects unsafe or secret-bearing build-time source links', () => {
  expect(sourceUrl(undefined)).toBeNull();
  for (const value of [
    'http://example.org/source',
    'javascript:alert(1)',
    'file:///tmp/source',
    'https://user:password@example.org/',
    'https://example.org/?token=x',
    'https://example.org/#secret',
    'https://example.org/a b',
    'https://example.org/' + 'x'.repeat(2048),
  ])
    expect(() => sourceUrl(value)).toThrow();
});
it('packages only fixed legal assets, including full project license and upstream attribution', () => {
  const root = resolve(import.meta.dirname, '..');
  const assets = legalAssets(root);
  expect(Object.keys(assets).sort()).toEqual(['LICENSE.txt', 'NOTICE.txt', 'THIRD-PARTY.txt']);
  expect(assets['LICENSE.txt']).toBe(readFileSync(resolve(root, 'LICENSE'), 'utf8'));
  expect(assets['NOTICE.txt']).toContain('AGPL-3.0-only');
  expect(assets['THIRD-PARTY.txt']).toContain('@jellyfin/sdk@1.0.0');
  expect(assets['THIRD-PARTY.txt']).toContain('Dailymotion');
  expect(assets['THIRD-PARTY.txt']).toContain('Brightcove');
  expect(assets['THIRD-PARTY.txt']).toContain('Mozilla Public License Version 2.0');
});
