// Runs only in the disposable verification container, never in production.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { request } from 'node:http';
import { chromium } from '/opt/browser/node_modules/playwright-core/index.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { username, password, cases } = JSON.parse(input);
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
let browser,
  step = 'launch';
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext(),
    page = await context.newPage();
  page.setDefaultTimeout(30000);
  const resources = [],
    reports = [],
    reportStatuses = [],
    errors = [];
  page.on('pageerror', () => errors.push('javascript'));
  page.on('response', (r) => {
    if (r.url().endsWith('/progress')) reportStatuses.push(r.status());
  });
  page.on('request', (r) => {
    if (r.url().includes('/playback/')) {
      resources.push(r.url());
      if (r.url().endsWith('/progress')) reports.push(r.postDataJSON());
    }
  });
  await page.goto('https://localhost:8443');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: `Welcome, ${username}.` }).waitFor();
  await page.getByRole('button', { name: 'Unified catalog', exact: true }).click();
  const scope = page.getByRole('region', { name: 'Unified catalog', exact: true });
  const results = [];
  for (const test of cases) {
    step = 'select ' + test.mode;
    await scope.getByRole('button', { name: test.title, exact: true }).click();
    if (test.sourceItemId) await scope.getByLabel('Source/version').selectOption(test.sourceItemId);
    await scope.getByRole('button', { name: 'Open player', exact: true }).click();
    const planned = page.waitForResponse(
      (r) => r.url().endsWith('/playback/sessions') && r.request().method() === 'POST',
    );
    await scope.getByRole('button', { name: 'Prepare playback', exact: true }).click();
    const response = await planned;
    assert.equal(response.status(), 201);
    const safe = await response.json();
    assert.equal(safe.mode, test.mode);
    if (test.expectedItemId) assert.equal(safe.itemId, test.expectedItemId);
    assert.ok(!JSON.stringify(safe).includes('http'));
    step = 'decode ' + test.mode;
    await page.waitForFunction(() => {
      const m = document.querySelector('video');
      return m && m.readyState >= 1 && m.videoWidth > 0 && m.duration > 10;
    });
    await scope.getByRole('button', { name: 'Play media', exact: true }).click();
    await page.waitForFunction(() => {
      const m = document.querySelector('video');
      return m.currentTime > 0.7 && !m.paused && !m.error;
    });
    await scope.getByRole('button', { name: 'Pause media', exact: true }).click();
    const at = await scope.locator('video').evaluate((m) => m.currentTime);
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(Math.abs((await scope.locator('video').evaluate((m) => m.currentTime)) - at) < 0.1);
    step = 'seek ' + test.mode;
    await scope.locator('video').evaluate((m) => {
      m.currentTime = 7;
    });
    await page.waitForFunction(() => {
      const m = document.querySelector('video');
      return !m.seeking && m.currentTime >= 6.9 && m.readyState >= 2;
    });
    await scope.getByRole('button', { name: 'Play media', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video').currentTime > 7.5);
    const stopped = page.waitForResponse(
      (r) => r.url().endsWith('/stop') && r.request().method() === 'POST',
    );
    await scope
      .getByRole('button', { name: 'Close player / choose another source', exact: true })
      .click();
    assert.equal((await stopped).status(), 204);
    await scope.getByRole('button', { name: 'Back to unified catalog', exact: true }).click();
    results.push({
      mode: safe.mode,
      decoded: true,
      progressed: true,
      paused: true,
      sought: true,
      itemId: safe.itemId,
    });
  }
  assert.ok(reports.some((r) => r.event === 'start'));
  assert.ok(reports.some((r) => r.event === 'progress' && r.positionMs > 6000));
  assert.ok(
    resources.every(
      (url) => url.startsWith('https://localhost:8443/api/v1/playback/') && !url.includes('?'),
    ),
  );
  assert.ok(reportStatuses.length > 0 && reportStatuses.every((status) => status === 204));
  assert.equal(errors.length, 0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  for (const path of resources.filter((p) => p.includes('/resources/')).slice(-2))
    assert.equal(await page.evaluate(async (p) => (await fetch(p)).status, path), 401);
  console.log(
    JSON.stringify({
      passed: true,
      playback: results,
      progressReports: true,
      sameOrigin: true,
      logout: true,
    }),
  );
} catch {
  console.error(JSON.stringify({ failedStep: step }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((r) => proxy.close(r));
}
