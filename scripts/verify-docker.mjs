/** Destructive only to freshly named test projects created by this process. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = `openflix-m1-check-${process.pid}-${randomBytes(4).toString('hex')}`;
const devProject = `${project}-dev`;
const origin = 'https://localhost:8443';
const masterKey = randomBytes(32).toString('base64');
const jellyfinPassword = randomBytes(32).toString('base64url');
const jellyfinTokenSeed = randomBytes(32).toString('hex');
const env = {
  ...process.env,
  OPENFLIX_BASE_URL: origin,
  OPENFLIX_MASTER_KEY: masterKey,
  OPENFLIX_VERIFY_JELLYFIN_PASSWORD: jellyfinPassword,
  OPENFLIX_VERIFY_JELLYFIN_TOKEN: jellyfinTokenSeed,
};
const jellyfinBaseUrl = 'http://jellyfin-fixture:8096/jellyfin';
const secrets = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')];
const [password, canary] = secrets;
secrets.push(masterKey, jellyfinPassword, jellyfinTokenSeed);
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
  assert.equal(containers.length, production ? 3 : 2);
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
  directoryMode: statSync('/config').mode & 0o7777,
  directoryOwner: statSync('/config').uid,
  runtimeUid: process.geteuid(),
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
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      writeFileSync(`/tmp/${project}-invalid-log.txt`, line, { mode: 0o600, flag: 'wx' });
      throw new Error(
        `Non-JSON log captured privately at /tmp/${project}-invalid-log.txt: ${error.message}`,
      );
    }
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
  await prod('build', 'server', 'web', 'browser', 'jellyfin-fixture');
  mark('Production images and isolated browser image build');
  phase = 'clean startup';
  prodTouched = true;
  await prod('up', '-d', '--wait', '--wait-timeout', '120', 'server', 'web', 'jellyfin-fixture');
  const original = await snapshot();
  assert.equal(original.migrations.length, 3);
  assert.equal(original.users.length, 0);
  assert.equal(original.sessions.length, 0);
  assert.equal(original.mode, 0o600);
  assert.equal(original.directoryMode, 0o700);
  assert.equal(original.directoryOwner, original.runtimeUid);
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
    `import { openDatabase } from '@openflix/database'; import { provisionUser } from './dist/auth.js'; import { writeFileSync } from 'node:fs'; const db=openDatabase('/config/openflix.sqlite'); await provisionUser(db,'container-test',${JSON.stringify(password)},'admin'); db.close(); writeFileSync('/config/verification-marker','persistent-config',{mode:0o600});`,
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
      JSON.stringify({
        username: 'container-test',
        password,
        jellyfin: {
          baseUrl: jellyfinBaseUrl,
          username: 'fixture-user',
          password: jellyfinPassword,
        },
      }),
    ),
  );
  assert.equal(browser.passed, true);
  assert.equal(browser.playback.length, 3);
  assert.ok(browser.playback.every((p) => p.decoded && p.progressed && p.paused && p.sought));
  mark(
    'Chromium decodes generated movie, episode and audio through OpenFlix; pause, seek, mobile layout and logout denial',
  );

  mark(`Trusted HTTPS browser login/reload/logout and HttpOnly cookie (${browser.browser})`);
  const initialContainers = await inspectPrivileges(prod, true);
  const serverId = initialContainers.find(
    (c) => c.Config.Labels['com.docker.compose.service'] === 'server',
  ).Id;
  phase = 'private storage access boundary';
  // Positive control: the unrelated UID can replace entries when a directory is
  // shared. It keeps all existing container restrictions (including cap_drop ALL).
  await serverScript(`import { mkdirSync, chmodSync, writeFileSync } from 'node:fs';
    mkdirSync('/tmp/storage-control'); chmodSync('/tmp/storage-control', 0o777);
    writeFileSync('/tmp/storage-control/db.sqlite', 'control', {mode:0o644});
    writeFileSync('/config/access-probe', 'test-only', {mode:0o644});`);
  const asUnrelated = (source) =>
    docker(
      ['exec', '-i', '--user', '65534:65534', serverId, 'node', '--input-type=module'],
      source,
    );
  await asUnrelated(`import assert from 'node:assert/strict';
    import { readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
    assert.equal(process.geteuid(), 65534);
    unlinkSync('/tmp/storage-control/db.sqlite'); symlinkSync('/tmp/insecure-target', '/tmp/storage-control/db.sqlite');
    mkdirSync('/tmp/foreign-owner', {mode:0o755});
    for (const action of [
      () => readFileSync('/config/access-probe'),
      () => readdirSync('/config'),
      () => writeFileSync('/config/new-file', 'attack'),
      () => unlinkSync('/config/openflix.sqlite'),
      () => renameSync('/config/openflix.sqlite', '/config/replaced'),
      () => symlinkSync('/tmp/insecure-target', '/config/injected.sqlite'),
      () => renameSync('/config', '/config-replaced'),
    ]) assert.throws(action, (error) => ['EACCES', 'EPERM', 'EROFS', 'EBUSY'].includes(error.code));`);
  await serverScript(`import assert from 'node:assert/strict';
    import { openDatabase } from '@openflix/database';
    import { existsSync, statSync, unlinkSync } from 'node:fs';
    assert.throws(() => openDatabase('/tmp/foreign-owner/db.sqlite'), /runtime UID/);
    assert.equal(existsSync('/tmp/foreign-owner/db.sqlite'), false);
    assert.equal(statSync('/tmp/foreign-owner').uid, 65534);
    unlinkSync('/config/access-probe');`);
  mark(
    'Unrelated UID cannot read, traverse, create or swap protected paths; foreign ownership fails closed',
  );
  // Restore an actual quiescent SQLite WAL snapshot, including recognizable data.
  await serverScript(`import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { openDatabase } from '@openflix/database';
    import { mkdirSync, chmodSync, copyFileSync, readFileSync, statSync, rmSync } from 'node:fs';
    const Database = createRequire(import.meta.resolve('@openflix/database'))('better-sqlite3');
    mkdirSync('/config/restore-probe'); chmodSync('/config/restore-probe', 0o777);
    const raw = new Database('/config/source-probe.sqlite');
    raw.pragma('journal_mode = WAL'); raw.pragma('wal_autocheckpoint = 0');
    raw.exec("CREATE TABLE preservation(value TEXT); INSERT INTO preservation VALUES ('sensitive-wal-probe')");
    assert.ok(readFileSync('/config/source-probe.sqlite-wal').includes(Buffer.from('sensitive-wal-probe')));
    const restored = '/config/restore-probe/openflix.sqlite';
    for (const suffix of ['', '-wal', '-shm']) {
      copyFileSync('/config/source-probe.sqlite' + suffix, restored + suffix);
      chmodSync(restored + suffix, 0o644);
    }
    const db = openDatabase(restored);
    assert.equal(statSync('/config/restore-probe').mode & 0o7777, 0o700);
    for (const suffix of ['', '-wal', '-shm']) assert.equal(statSync(restored + suffix).mode & 0o7777, 0o600);
    const reader = new Database(restored);
    assert.equal(reader.prepare('SELECT value FROM preservation').get().value, 'sensitive-wal-probe');
    assert.equal(reader.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 3);
    reader.close(); db.close(); raw.close();
    rmSync('/config/restore-probe', {recursive:true}); rmSync('/config/source-probe.sqlite');`);
  mark(
    'Production SQLite restore repairs directory and 0644 DB/WAL/SHM while retaining committed data',
  );
  const volumeName = initialContainers
    .find((c) => c.Id === serverId)
    .Mounts.find((m) => m.Destination === '/config').Name;
  phase = 'production connector administration';
  const connectorAdd = await request('/api/v1/connectors', {
    method: 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Persistent fixture',
      baseUrl: jellyfinBaseUrl,
      username: 'fixture-user',
      password: jellyfinPassword,
    }),
  });
  assert.equal(connectorAdd.status, 201);
  const connectorId = JSON.parse(connectorAdd.body).connector.id;
  for (const secret of secrets) assert.ok(!connectorAdd.body.includes(secret));
  const stored = JSON.parse(
    await serverScript(`
    import {openDatabase} from '@openflix/database';
    const db=openDatabase('/config/openflix.sqlite');
    console.log(JSON.stringify(db.getConnector(${JSON.stringify(connectorId)})));db.close();`),
  );
  assert.equal(JSON.parse(stored.credentialEnvelope).algorithm, 'aes-256-gcm');
  for (const secret of secrets) assert.ok(!JSON.stringify(stored).includes(secret));
  const fixtureState = async () =>
    JSON.parse(
      await serverScript(
        `console.log(JSON.stringify(await (await fetch('http://jellyfin-fixture:8096/__fixture/state')).json()));`,
      ),
    );
  const authenticated = (await fixtureState()).authentications;
  mark(
    'Production admin API encrypts Jellyfin fixture credential and exposes only normalized libraries',
  );
  phase = 'production catalog';
  const catalogRead = async (path) => {
    const result = await request('/api/v1/catalog' + path, { headers: { cookie } });
    assert.equal(result.status, 200);
    for (const secret of secrets) assert.ok(!result.body.includes(secret));
    return JSON.parse(result.body);
  };
  const catalogSync = async (expected) => {
    const started = await request(`/api/v1/catalog/sync/${connectorId}`, {
      method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(started.status, 202);
    for (let attempt = 0; attempt < 100; attempt++) {
      await delay(100);
      const status = await catalogRead(`/sync/${connectorId}`);
      if (status.state !== 'syncing') {
        assert.equal(status.state, expected);
        return;
      }
    }
    throw new Error('Catalog sync did not finish');
  };
  await catalogSync('successful');
  const catalogLibraries = (await catalogRead('/libraries')).libraries;
  const movies = catalogLibraries.find((l) => l.name === 'Fixture movies'),
    tv = catalogLibraries.find((l) => l.name === 'Tv shows');
  assert.equal(movies.type, 'movie');
  assert.equal(tv.type, 'television');
  assert.equal(tv.upstreamType, null);
  const originalCatalog = await catalogRead(`/libraries/${movies.id}/items?limit=100`);
  assert.equal(originalCatalog.total, 206);
  assert.equal(
    (await catalogRead(`/libraries/${movies.id}/items?offset=200&limit=100`)).items.length,
    6,
  );
  for (const library of [movies, tv]) {
    const folders = await catalogRead(`/libraries/${library.id}/items?type=unknown`);
    assert.equal(folders.total, 1);
    assert.equal(folders.items[0].upstreamType, 'Folder');
    assert.equal(folders.items[0].structural, true);
  }
  const episodes = await catalogRead(`/libraries/${tv.id}/items?type=episode`);
  assert.equal(episodes.total, 1);
  assert.equal((await catalogRead(`/items/${episodes.items[0].seasonId}`)).item.type, 'season');
  await catalogSync('successful');
  assert.equal(
    (await catalogRead(`/libraries/${movies.id}/items`)).items[0].id,
    originalCatalog.items[0].id,
  );
  mark(
    'Catalog full scan, Folder-neutral movie/TV classification, multi-page browsing, hierarchy and idempotent resync',
  );
  const fixtureMode = (mode) =>
    serverScript(`await fetch('http://jellyfin-fixture:8096/__fixture/catalog?mode=${mode}');`);
  const stableCatalog = await catalogRead(`/libraries/${movies.id}/items?limit=100`);
  await fixtureMode('partial');
  await catalogSync('failed');
  assert.deepEqual(await catalogRead(`/libraries/${movies.id}/items?limit=100`), stableCatalog);
  await fixtureMode('updated');
  await catalogSync('successful');
  const updatedCatalog = await catalogRead(`/libraries/${movies.id}/items?limit=100`);
  assert.equal(updatedCatalog.total, 205);
  assert.equal(updatedCatalog.items[0].title, 'Changed fixture movie');
  assert.equal(updatedCatalog.items[0].id, originalCatalog.items[0].id);
  const persistedLibraries = await catalogRead('/libraries');
  mark(
    'Failed partial scan preserves published catalog; successful resync updates and prunes safely',
  );
  phase = 'production playback transport';
  const playbackMutation = async (path, body) =>
    request('/api/v1/playback' + path, {
      method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const preparePlayback = async () => {
    const result = await playbackMutation('/sessions', {
      itemId: updatedCatalog.items[0].id,
      profile: { formats: ['mp4-h264-aac'] },
    });
    assert.equal(result.status, 201);
    for (const secret of secrets) assert.ok(!result.body.includes(secret));
    assert.doesNotMatch(
      result.body,
      /mediaSourceId|credentialEnvelope|jellyfin-fixture|private\/fixture/,
    );
    return JSON.parse(result.body);
  };
  let oldPlayback = await preparePlayback();
  const streamHead = await request(oldPlayback.streamPath, { method: 'HEAD', headers: { cookie } });
  assert.equal(streamHead.status, 200);
  assert.equal(streamHead.headers.get('content-type'), 'video/mp4');
  const mediaSize = Number(streamHead.headers.get('content-length'));
  assert.ok(mediaSize > 10000);
  const range = await fetch('http://127.0.0.1:8080' + oldPlayback.streamPath, {
    headers: { cookie, range: 'bytes=10-109' },
  });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 10-109/${mediaSize}`);
  assert.equal((await range.arrayBuffer()).byteLength, 100);
  assert.equal(
    (await request(oldPlayback.streamPath, { headers: { cookie, range: `bytes=${mediaSize}-` } }))
      .status,
    416,
  );
  assert.equal((await request(oldPlayback.streamPath)).status, 401);
  assert.equal((await playbackMutation(`/sessions/${oldPlayback.id}/stop`, {})).status, 204);
  mark(
    'Authenticated production HEAD, byte ranges, Content-Range, 416 and secret-free playback plans',
  );
  await serverScript("await fetch('http://jellyfin-fixture:8096/__fixture/playback?mode=large');");
  const large = await preparePlayback();
  const memory = JSON.parse(
    await serverScript(`
    import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
    const rss=()=>Number.parseInt(readFileSync('/proc/1/status','utf8').split('VmRSS:')[1],10)*1024;
    const baseline=rss();let peak=baseline,received=0;
    const abort=new AbortController();
    const response=await fetch('http://127.0.0.1:8787'+${JSON.stringify(large.streamPath)}, {headers:{cookie:${JSON.stringify(cookie)}},signal:abort.signal});
    assert.equal(response.status,200);assert.equal(Number(response.headers.get('content-length')),4*1024**3);
    for await(const chunk of response.body){received+=chunk.length;peak=Math.max(peak,rss());if(received>=16*1024**2){break;}}
    assert.ok(peak-baseline<96*1024**2,'Streaming memory grew beyond bounded sanity limit');
    console.log(JSON.stringify({received,rssGrowth:peak-baseline}));
  `),
  );
  assert.ok(memory.received >= 16 * 1024 ** 2);
  await delay(500);
  const largeState = await fixtureState();
  assert.ok(largeState.playback.bytes < 128 * 1024 ** 2);
  assert.ok(largeState.playback.cancelled > 0);
  assert.ok(largeState.playback.reports >= 3);
  await playbackMutation(`/sessions/${large.id}/stop`, {});
  await serverScript("await fetch('http://jellyfin-fixture:8096/__fixture/playback?mode=normal');");
  mark(
    `4 GiB synthetic stream stays bounded and cancels upstream (RSS growth ${memory.rssGrowth} bytes)`,
  );
  oldPlayback = await preparePlayback();
  const verifyPersistence = async () => {
    await ready('http://127.0.0.1:8080/health');
    assert.equal((await request(oldPlayback.streamPath, { headers: { cookie } })).status, 410);
    oldPlayback = await preparePlayback();
    assert.equal(
      (await request(oldPlayback.streamPath, { method: 'HEAD', headers: { cookie } })).status,
      200,
    );
    assert.equal((await request('/api/v1/me', { headers: { cookie } })).status, 200);
    const current = await snapshot();
    assert.equal(current.mode, 0o600);
    assert.equal(current.directoryMode, 0o700);
    assert.equal(current.directoryOwner, current.runtimeUid);
    assert.deepEqual(current.migrations, before.migrations);
    assert.deepEqual(current.users, before.users);
    assert.deepEqual(current.sessions, before.sessions);
    assert.equal(current.integrity, 'ok');
    assert.deepEqual(await catalogRead('/libraries'), persistedLibraries);
    assert.deepEqual(await catalogRead(`/libraries/${movies.id}/items?limit=100`), updatedCatalog);
    const list = await request('/api/v1/connectors', { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(JSON.parse(list.body).connectors[0].id, connectorId);
    assert.ok(!list.body.includes('credentialEnvelope'));
    const reconnect = await request(`/api/v1/connectors/${connectorId}/test`, {
      method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(reconnect.status, 200);
    assert.equal(JSON.parse(reconnect.body).connector.state, 'connected');
    assert.equal((await fixtureState()).authentications, authenticated);
    assert.equal(
      (await prod('exec', '-T', 'server', 'cat', '/config/verification-marker')).trim(),
      'persistent-config',
    );
  };
  phase = 'backend DNS recovery';
  await prod('stop', '--timeout', '15', 'server');
  await prod('rm', '-f', 'server');
  await prod('restart', 'web');
  let staticReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      if ((await request('/')).status === 200) {
        staticReady = true;
        break;
      }
    } catch {
      /* Nginx startup */
    }
    await delay(200);
  }
  assert.ok(staticReady, 'Frontend must start without a DNS-resolvable backend');
  assert.ok([502, 503].includes((await request('/health')).status));
  await prod('up', '-d', '--wait', '--wait-timeout', '120');
  await verifyPersistence();
  mark('Nginx starts without backend DNS and recovers after server recreation');
  phase = 'restart';
  await logs();
  // Simulate a database restored with permissive mode bits, using test data only.
  await prod('exec', '-T', 'server', 'chmod', '0755', '/config');
  await prod('exec', '-T', 'server', 'chmod', '0644', '/config/openflix.sqlite');
  assert.equal((await snapshot()).mode, 0o644);
  await prod('restart');
  await prod('up', '-d', '--wait', '--wait-timeout', '120');
  await verifyPersistence();
  mark(
    'Container restart repairs directory 0755 and database 0644 permissions and retains account, session, migrations and config',
  );
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
  mark(
    'Ephemeral playback grants fail after restart; persisted encrypted connector starts new playback',
  );
  phase = 'replacement';
  await logs();
  await prod('down');
  await docker(['volume', 'inspect', volumeName]);
  await prod('up', '-d', '--wait', '--wait-timeout', '120');
  await verifyPersistence();
  const replacement = await inventory(prod);
  assert.ok(replacement.every((c) => c.Id !== serverId));
  mark('Compose down/up preserves volumes, accounts, sessions and encrypted connector reconnect');
  const removed = await request(`/api/v1/connectors/${connectorId}`, {
    method: 'DELETE',
    headers: { origin, cookie },
  });
  assert.equal(removed.status, 200);
  assert.equal((await request(oldPlayback.streamPath, { headers: { cookie } })).status, 410);
  assert.equal(JSON.parse(removed.body).revocation, 'confirmed');
  assert.equal((await fixtureState()).active, 0);
  assert.equal((await catalogRead('/libraries')).libraries.length, 0);
  assert.equal(
    (await request(`/api/v1/catalog/items/${updatedCatalog.items[0].id}`, { headers: { cookie } }))
      .status,
    404,
  );
  mark('Catalog persists through all restart/recreation checks and connector removal cascades');
  mark('Connector removal revokes only its fixture session and removes saved credentials');
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
  const passed = stripVTControlCharacters(suite).match(/Tests\s+(\d+) passed/);
  assert.ok(passed && Number(passed[1]) >= 254, 'Expected at least 254 passing Linux tests');
  mark(
    `Complete pnpm check inside Linux container: ${passed[1]} tests, builds, types and formatting`,
  );
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
