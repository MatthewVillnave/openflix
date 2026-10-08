// Runs only in the disposable verification container, never in production.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { request } from 'node:http';
import { chromium } from '/opt/browser/node_modules/playwright-core/index.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { username, password, jellyfin } = JSON.parse(input);
const dir = '/tmp/browser-home';
mkdirSync(dir, { recursive: true, mode: 0o700 });
const openssl = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
openssl(
  'req',
  '-x509',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-days',
  '1',
  '-subj',
  '/CN=OpenFlix disposable test CA',
  '-keyout',
  'ca.key',
  '-out',
  'ca.crt',
);
openssl(
  'req',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-subj',
  '/CN=localhost',
  '-keyout',
  'server.key',
  '-out',
  'server.csr',
);
writeFileSync(
  `${dir}/server.ext`,
  'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n',
);
openssl(
  'x509',
  '-req',
  '-in',
  'server.csr',
  '-CA',
  'ca.crt',
  '-CAkey',
  'ca.key',
  '-CAcreateserial',
  '-days',
  '1',
  '-extfile',
  'server.ext',
  '-out',
  'server.crt',
);
// Trust only in this disposable user's browser stores. No host trust-store changes,
// ignoreHTTPSErrors, certificate-warning bypass, or global insecure setting.
for (const location of ['.pki/nssdb', '.local/share/pki/nssdb']) {
  const db = `${dir}/${location}`;
  mkdirSync(db, { recursive: true, mode: 0o700 });
  execFileSync('certutil', ['-N', '-d', `sql:${db}`, '--empty-password']);
  execFileSync('certutil', [
    '-A',
    '-d',
    `sql:${db}`,
    '-n',
    'OpenFlix test CA',
    '-t',
    'C,,',
    '-i',
    `${dir}/ca.crt`,
  ]);
}
const proxy = createServer(
  { key: readFileSync(`${dir}/server.key`), cert: readFileSync(`${dir}/server.crt`) },
  (req, res) => {
    const upstream = request(
      { hostname: 'web', port: 8080, path: req.url, method: req.method, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  },
);
await new Promise((resolve) => proxy.listen(8443, '127.0.0.1', resolve));
let browser;
let step = 'launch';
try {
  // Only this disposable test browser disables Chromium's OS sandbox; the
  // container is non-root, cap-drop ALL, read-only, and visits only this fixture.
  browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = [];
  const playbackResults = [];
  const mediaRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/playback/')) mediaRequests.push(request.url());
  });
  page.on('pageerror', () => failures.push('javascript error'));
  step = 'trusted HTTPS frontend';
  await page.goto('https://localhost:8443');
  assert.equal(await page.title(), 'OpenFlix');
  await page.getByLabel('Username', { exact: true }).waitFor();
  step = 'sign in';
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: `Welcome, ${username}.` }).waitFor();
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === '__Host-openflix_session');
  assert.ok(session?.secure && session.httpOnly && session.sameSite === 'Strict');
  assert.equal(await page.evaluate(() => document.cookie), '');
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  step = 'session reload';
  await page.reload();
  await page.getByRole('heading', { name: `Welcome, ${username}.` }).waitFor();
  if (jellyfin) {
    step = 'Jellyfin administrator UI';
    await page.getByRole('button', { name: 'Settings · Media Servers', exact: true }).click();
    await page.getByLabel('Display name', { exact: true }).fill('Browser fixture');
    await page.getByLabel('Jellyfin URL', { exact: true }).fill(jellyfin.baseUrl);
    await page.getByLabel('Jellyfin username', { exact: true }).fill(jellyfin.username);
    await page.getByLabel('Jellyfin password', { exact: true }).fill(jellyfin.password);
    const addedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/connectors') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Add Jellyfin server', exact: true }).click();
    const added = await addedResponse;
    assert.equal(added.status(), 201);
    const publicBody = await added.text();
    assert.ok(!publicBody.includes(jellyfin.password));
    assert.ok(!publicBody.includes('credentialEnvelope'));
    await page.getByText('Fixture movies', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Jellyfin password', { exact: true }).inputValue(), '');
    await page.reload();
    await page.getByRole('button', { name: 'Settings · Media Servers', exact: true }).click();
    await page.getByRole('heading', { name: 'Browser fixture', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reconnect / test', exact: true }).click();
    await page
      .getByText('Connection verified using its saved credential.', { exact: true })
      .waitFor();
    const exercisePlayer = async (kind, keepPlaying = false) => {
      step = `actual ${kind} decode, pause and seek`;
      const planned = page.waitForResponse(
        (r) => r.url().endsWith('/playback/sessions') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Prepare playback', exact: true }).click();
      const response = await planned;
      assert.equal(response.status(), 201);
      const safe = await response.json();
      assert.match(safe.streamPath, /^\/api\/v1\/playback\/sessions\/[a-f0-9-]+\/stream$/);
      for (const forbidden of [
        jellyfin.password,
        jellyfin.baseUrl,
        'private/fixture',
        'credentialEnvelope',
        'api_key',
        'AccessToken',
      ])
        assert.ok(!JSON.stringify(safe).includes(forbidden));
      const selector = kind === 'audio' ? 'audio' : 'video';
      await page.waitForFunction((s) => {
        const m = document.querySelector(s);
        return m && m.readyState >= 1 && m.duration > 10 && (s === 'audio' || m.videoWidth > 0);
      }, selector);
      await page.getByRole('button', { name: 'Play media', exact: true }).click();
      await page.waitForFunction((s) => {
        const m = document.querySelector(s);
        return m.currentTime > 0.6 && !m.paused && !m.error;
      }, selector);
      await page.getByRole('button', { name: 'Pause media', exact: true }).click();
      const paused = await page
        .locator(selector)
        .evaluate((m) => ({ paused: m.paused, time: m.currentTime }));
      assert.equal(paused.paused, true);
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.ok(
        Math.abs((await page.locator(selector).evaluate((m) => m.currentTime)) - paused.time) < 0.1,
      );
      await page.locator(selector).evaluate((m) => {
        m.currentTime = 7;
      });
      await page.waitForFunction((s) => {
        const m = document.querySelector(s);
        return !m.seeking && m.currentTime >= 6.9 && m.readyState >= 2;
      }, selector);
      await page.getByRole('button', { name: 'Play media', exact: true }).click();
      await page.waitForFunction((s) => {
        const m = document.querySelector(s);
        return m.currentTime > 7.5 && !m.error;
      }, selector);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok((await page.locator(selector).boundingBox()).width <= 390);
      await page.setViewportSize({ width: 1280, height: 900 });
      playbackResults.push({ kind, decoded: true, progressed: true, paused: true, sought: true });
      if (!keepPlaying)
        await page.getByRole('button', { name: 'Return to catalog', exact: true }).click();
      return safe;
    };
    step = 'catalog synchronization and TV hierarchy';
    await page.getByRole('button', { name: 'Sync Browser fixture', exact: true }).click();
    await page
      .getByRole('button', { name: 'Tv shows · Browser fixture (television)', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Browse children of Fixture series', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Browse children of Fixture season', exact: true })
      .click();
    await page.getByRole('button', { name: 'Fixture episode', exact: true }).click();
    await page
      .getByRole('article', { name: 'Item details' })
      .getByText('Episode 1', { exact: true })
      .waitFor();
    await exercisePlayer('episode');
    await page
      .getByRole('button', { name: 'Fixture movies · Browser fixture (movie)', exact: true })
      .click();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.getByRole('button', { name: 'Fixture movie 051', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Fixture movie 051', exact: true }).click();
    await exercisePlayer('movie');
    await page
      .getByRole('button', { name: 'Fixture music · Browser fixture (music)', exact: true })
      .click();
    await page.getByRole('button', { name: 'Fixture track', exact: true }).click();
    const lastPlayback = await exercisePlayer('audio', true);
    assert.equal(
      await page.evaluate(
        async (path) => (await fetch(path, { method: 'HEAD' })).status,
        lastPlayback.streamPath,
      ),
      200,
    );
    step = 'playback logout authorization';
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByLabel('Username', { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(async (path) => (await fetch(path)).status, lastPlayback.streamPath),
      401,
    );
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: `Welcome, ${username}.` }).waitFor();
    assert.equal(
      await page.evaluate(async (path) => (await fetch(path)).status, lastPlayback.streamPath),
      410,
    );
    assert.ok(
      mediaRequests.every(
        (url) => url.startsWith('https://localhost:8443/api/v1/playback/') && !url.includes('?'),
      ),
    );
    await page.getByRole('button', { name: 'Settings · Media Servers', exact: true }).click();
    step = 'connector removal after catalog import';
    await page.getByRole('button', { name: 'Disconnect / remove', exact: true }).click();
    await page
      .getByText('Connection removed and its Jellyfin session ended.', { exact: true })
      .waitFor();
    assert.equal(await page.evaluate(() => localStorage.length), 0);
  }
  step = 'logout';
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).waitFor();
  await page.reload();
  await page.getByLabel('Username', { exact: true }).waitFor();
  assert.equal(
    (await context.cookies()).some((cookie) => cookie.name === '__Host-openflix_session'),
    false,
  );
  assert.equal(failures.length, 0);
  // Return only non-sensitive verification metadata.
  console.log(
    JSON.stringify({ passed: true, browser: browser.version(), playback: playbackResults }),
  );
} catch {
  console.error(`Browser verification failed at: ${step}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => proxy.close(resolve));
}
