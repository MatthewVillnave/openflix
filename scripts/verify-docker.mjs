/** Destructive only to freshly named test projects created by this process. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = `openflix-m1-check-${process.pid}-${randomBytes(4).toString('hex')}`;
const devProject = `${project}-dev`;
const origin = 'https://localhost:8443';
const env = { ...process.env, OPENFLIX_BASE_URL: origin };
const secrets = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')];
const [password, canary] = secrets;
let phase = 'prerequisites';
const collectedLogs = [];
const checks = [];
let prodTouched = false;
let devTouched = false;

async function docker(args, input) {
  const timeout = args.includes('build') ? 1200000 : 180000;
  const child = execFile(
    'docker',
    args,
    { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout },
    () => {},
  );
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(input);
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `docker ${args[0]} failed (${code}): ${stderr.slice(-4000)}\n${stdout.slice(-4000)}`,
            ),
          ),
    );
  });
  return stdout;
}
const prod = (...args) =>
  docker([
    'compose',
    '-p',
    project,
    '-f',
    'docker-compose.yml',
    '-f',
    'docker/compose.verify.yml',
    ...args,
  ]);
const dev = (...args) =>
  docker(['compose', '-p', devProject, '-f', 'docker/compose.dev.yml', ...args]);
const serverScript = (source) =>
  docker(['compose', '-p', project, 'exec', '-T', 'server', 'node', '--input-type=module'], source);
const mark = (message) => {
  checks.push(message);
  console.log(`PASS ${message}`);
};
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:8080${path}`, {
    ...options,
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, headers: response.headers, body: await response.text() };
}
async function ready(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok && (await response.json()).database === 'ok') return;
    } catch {
      /* startup race */
    }
    await delay(1000);
  }
  throw new Error('Readiness timeout');
}
async function inventory(compose) {
  const ids = (await compose('ps', '-aq')).trim().split(/\s+/).filter(Boolean);
  return JSON.parse(await docker(['inspect', ...ids]));
}
async function inspectPrivileges(compose, production) {
  const containers = await inventory(compose);
  assert.equal(containers.length, 2);
  for (const c of containers) {
    assert.ok(c.Config.User && !['0', 'root'].includes(c.Config.User));
    assert.equal(c.HostConfig.Privileged, false);
    assert.ok(c.HostConfig.CapDrop.includes('ALL'));
    assert.ok(c.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
    assert.notEqual(c.HostConfig.NetworkMode, 'host');
    assert.notEqual(c.HostConfig.PidMode, 'host');
    assert.ok(c.Mounts.every((mount) => !mount.Source.includes('docker.sock')));
    if (production) assert.equal(c.HostConfig.ReadonlyRootfs, true);
    const status = await docker(['exec', c.Id, 'sh', '-c', 'id -u; cat /proc/self/status']);
    assert.notEqual(status.split('\n')[0], '0');
    assert.match(status, /CapEff:\s+0+\b/);
    assert.match(status, /NoNewPrivs:\s+1\b/);
    for (const bindings of Object.values(c.NetworkSettings.Ports)) {
      for (const binding of bindings ?? []) assert.equal(binding.HostIp, '127.0.0.1');
    }
  }
  if (production) {
    const server = containers.find(
      (c) => c.Config.Labels['com.docker.compose.service'] === 'server',
    );
    assert.equal(server.NetworkSettings.Ports['8787/tcp'], null);
    await docker([
      'exec',
      server.Id,
      'sh',
      '-c',
      'if touch /app/should-not-write 2>/dev/null; then exit 1; fi',
    ]);
  }
  mark(
    `${production ? 'Production' : 'Development'} container identities, capabilities and isolation`,
  );
  return containers;
}
const snapshotSource = `
import { createRequire } from 'node:module';
const Database = createRequire(import.meta.resolve('@openflix/database'))('better-sqlite3');
import { readFileSync, statSync } from 'node:fs';
const db = new Database('/config/openflix.sqlite');
console.log(JSON.stringify({
  migrations: db.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),
  users: db.prepare('SELECT id, username, password_hash FROM users ORDER BY id').all(),
  sessions: db.prepare('SELECT token_hash FROM user_sessions ORDER BY token_hash').all(),
  mode: statSync('/config/openflix.sqlite').mode & 0o777,
  integrity: db.pragma('integrity_check', {simple:true}),
}));
db.close();`;
const snapshot = async () => JSON.parse(await serverScript(snapshotSource));
async function logs() {
  collectedLogs.push(await prod('logs', '--no-color', '--no-log-prefix'));
}
function checkLogs() {
  const combined = collectedLogs.join('\n');
  for (const secret of secrets)
    assert.ok(!combined.includes(secret), 'A test secret leaked into logs');
  assert.doesNotMatch(
    combined,
    /\$argon2id\$|BEGIN (?:RSA )?PRIVATE KEY|ERR_MODULE_NOT_FOUND|EACCES|uncaught|\bFATAL\b/,
  );
  for (const line of combined.split('\n').filter(Boolean)) {
    const entry = JSON.parse(line);
    assert.ok(entry.level < 50, 'Application error in container logs');
    assert.ok(!entry.req && !entry.res, 'Raw HTTP metadata in logs');
  }
  mark('Container logs contain structured safe events, no application errors or test secrets');
}
try {
  console.log(`Verifying isolated projects ${project} and ${devProject}`);
  await docker(['info', '--format', '{{.ServerVersion}}']);
  await prod('config', '--quiet');
  await dev('config', '--quiet');
  for (const name of [project, devProject]) {
    const prior = (
      await docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${name}`])
    ).trim();
    const priorVolumes = (
      await docker(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${name}`])
    ).trim();
    assert.equal(prior + priorVolumes, '', 'Refusing to reuse an existing project');
  }
  phase = 'image builds';
  console.log('Building production and disposable browser images…');
  await prod('build', 'server', 'web', 'browser');
  mark('Production images and isolated browser image build');
  phase = 'clean startup';
  prodTouched = true;
  await prod('up', '-d', '--wait', '--wait-timeout', '120', 'server', 'web');
  const original = await snapshot();
  assert.equal(original.migrations.length, 1);
  assert.equal(original.users.length, 0);
  assert.equal(original.sessions.length, 0);
  assert.equal(original.mode, 0o600);
  assert.equal(original.integrity, 'ok');
  await prod('exec', '-T', 'server', 'node', 'dist/cli.js', 'db:migrate');
  await prod('exec', '-T', 'server', 'node', 'dist/cli.js', 'db:migrate');
  assert.deepEqual((await snapshot()).migrations, original.migrations);
  mark('Fresh-volume migrations, idempotence, SQLite integrity and private permissions');
  phase = 'HTTP checks';
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { status: 'healthy', database: 'ok' });
  const web = await request('/');
  assert.equal(web.status, 200);
  assert.match(web.body, /<title>OpenFlix<\/title>/);
  assert.ok(web.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  const assets = [...web.body.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(assets.length >= 2);
  for (const asset of assets) assert.equal((await request(asset)).status, 200);
  assert.equal((await request('/api/v1/me')).status, 401);
  assert.equal((await request('/api/v1/auth/logout', { method: 'POST' })).status, 403);
  assert.equal(
    (
      await request('/api/v1/auth/login', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'unknown', password: canary }),
      })
    ).status,
    401,
  );
  await request(`/missing?token=${canary}`, {
    headers: { authorization: `Bearer ${canary}`, cookie: `test=${canary}` },
  });
  mark('Frontend/assets, health, API proxy, CSP, unauthorized access and CSRF rejection');
  await serverScript(
    `import { openDatabase } from '@openflix/database'; import { provisionUser } from './dist/auth.js'; import { writeFileSync } from 'node:fs'; const db=openDatabase('/config/openflix.sqlite'); await provisionUser(db,'container-test',${JSON.stringify(password)}); db.close(); writeFileSync('/config/verification-marker','persistent-config',{mode:0o600});`,
  );
  const login = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'container-test', password }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /__Host-openflix_session=/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.doesNotMatch(setCookie, /Domain=/);
  const cookie = setCookie.split(';')[0];
  const token = cookie.split('=')[1];
  secrets.push(token);
  const before = await snapshot();
  assert.match(before.users[0].password_hash, /^\$argon2id\$/);
  secrets.push(before.users[0].password_hash);
  assert.equal(before.sessions[0].token_hash, createHash('sha256').update(token).digest('hex'));
  mark('Real Argon2 login, safe production cookie and hashed session storage');
  phase = 'HTTPS browser';
  const browser = JSON.parse(
    await docker(
      [
        'compose',
        '-p',
        project,
        '-f',
        'docker-compose.yml',
        '-f',
        'docker/compose.verify.yml',
        'run',
        '--rm',
        '--no-deps',
        '-T',
        'browser',
      ],
      JSON.stringify({ username: 'container-test', password }),
    ),
  );
  assert.equal(browser.passed, true);

  mark(`Trusted HTTPS browser login/reload/logout and HttpOnly cookie (${browser.browser})`);
  const initialContainers = await inspectPrivileges(prod, true);
  const serverId = initialContainers.find(
    (c) => c.Config.Labels['com.docker.compose.service'] === 'server',
  ).Id;
  const volumeName = initialContainers
    .find((c) => c.Id === serverId)
    .Mounts.find((m) => m.Destination === '/config').Name;
  const verifyPersistence = async () => {
    await ready('http://127.0.0.1:8080/health');
    assert.equal((await request('/api/v1/me', { headers: { cookie } })).status, 200);
    const current = await snapshot();
    assert.deepEqual(current.migrations, before.migrations);
    assert.deepEqual(current.users, before.users);
    assert.deepEqual(current.sessions, before.sessions);
    assert.equal(current.integrity, 'ok');
    assert.equal(
      (await prod('exec', '-T', 'server', 'cat', '/config/verification-marker')).trim(),
      'persistent-config',
    );
  };
  phase = 'restart';
  await logs();
  await prod('restart');
  await prod('up', '-d', '--wait', '--wait-timeout', '120');
  await verifyPersistence();
  mark('Container restart retains account, session, migration ledger and config marker');
  phase = 'clean stop/start';
  await prod('stop', '--timeout', '15');
  const stopped = await inventory(prod);
  for (const c of stopped) {
    assert.equal(c.State.ExitCode, 0);
    assert.equal(c.State.OOMKilled, false);
    assert.equal(c.State.Status, 'exited');
  }
  await prod('up', '-d', '--wait', '--wait-timeout', '120');
  await verifyPersistence();
  mark('Clean shutdown exits zero; restart restores persistent state');
  phase = 'replacement';
  await logs();
  await prod('down');
  await docker(['volume', 'inspect', volumeName]);
  await prod('up', '-d', '--wait', '--wait-timeout', '120');
  await verifyPersistence();
  const replacement = await inventory(prod);
  assert.ok(replacement.every((c) => c.Id !== serverId));
  mark('Compose down/up replaces containers while preserving named-volume data and sessions');
  const logout = await request('/api/v1/auth/logout', {
    method: 'POST',
    headers: { origin, cookie },
  });
  assert.equal(logout.status, 204);
  assert.equal((await request('/api/v1/me', { headers: { cookie } })).status, 401);
  await logs();
  checkLogs();
  phase = 'development containers';
  console.log('Building and checking development containers…');
  await dev('build');
  devTouched = true;
  await dev('up', '-d');
  await ready('http://127.0.0.1:5173/health');
  assert.match(await (await fetch('http://127.0.0.1:5173/')).text(), /<title>OpenFlix<\/title>/);
  await inspectPrivileges(dev, false);
  const developmentLogs = await dev('logs', '--no-color', '--no-log-prefix');
  assert.doesNotMatch(developmentLogs, /ERR_MODULE_NOT_FOUND|EACCES|uncaught|\bFATAL\b/);
  for (const secret of secrets)
    assert.ok(!developmentLogs.includes(secret), 'A test secret leaked into development logs');
  mark('Docker development frontend and API proxy');
  phase = 'Linux full suite';
  const suite = await dev('run', '--rm', '--no-deps', '-T', 'server', 'pnpm', 'check');
  assert.match(suite, /52 passed/);
  mark('Complete pnpm check inside Linux container: 52 tests, builds, types and formatting');
  console.log(`DOCKER VERIFICATION PASS: ${checks.length} check groups`);
} catch (error) {
  let message = `${phase}: ${error.message}`;
  message = message.replace(
    /(?:__Host-)?openflix_session=[^;\s"\']+/g,
    'openflix_session=[REDACTED]',
  );
  for (const secret of secrets) message = message.replaceAll(secret, '[REDACTED]');
  console.error(`DOCKER VERIFICATION FAIL: ${message}`);
  process.exitCode = 1;
} finally {
  for (const [touched, compose, name] of [
    [devTouched, dev, devProject],
    [prodTouched, prod, project],
  ]) {
    if (!touched) continue;
    try {
      await compose('down', '--volumes', '--remove-orphans');
    } catch {
      console.error(`Cleanup failed for disposable project ${name}; remove its test resources.`);
      process.exitCode = 1;
    }
  }
}
