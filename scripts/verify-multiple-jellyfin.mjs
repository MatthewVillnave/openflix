/** Two fresh isolated Jellyfin servers. Never accepts a household URL or credentials. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const project = 'openflix-m5-' + process.pid + '-' + randomBytes(4).toString('hex');
const password = randomBytes(32).toString('base64url'),
  key = randomBytes(32).toString('base64');
const secrets = [password, key],
  checks = [];
const env = {
  ...process.env,
  OPENFLIX_BASE_URL: 'https://localhost:8443',
  OPENFLIX_MASTER_KEY: key,
};
const files = ['-f', 'docker-compose.yml', '-f', 'docker/compose.multiple.verify.yml'];
const run = (args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      args,
      { env, maxBuffer: 32 * 1024 * 1024, timeout: args.includes('build') ? 1200000 : 240000 },
      (error, out, err) =>
        error
          ? reject(
              new Error(
                'Disposable operation failed: ' + err.slice(-1200) + ' ' + out.slice(-1000),
              ),
            )
          : resolve(out),
    );
    child.stdin.end(input);
  });
const compose = (...args) => run(['compose', '-p', project, ...files, ...args]);
const mark = (label) => {
  checks.push(label);
  console.log('PASS ' + label);
};
let phase = 'build';
try {
  await compose(
    'build',
    'server',
    'web',
    'jellyfin-a',
    'jellyfin-b',
    'multiple-media-a',
    'multiple-media-b',
    'browser',
  );
  phase = 'startup';
  await compose(
    'up',
    '-d',
    '--wait',
    'server',
    'web',
    'jellyfin-a',
    'jellyfin-b',
    'multiple-media-a',
    'multiple-media-b',
  );
  const port = async (service) =>
    Number(
      (await compose('port', service, service === 'web' ? '8080' : '8096'))
        .trim()
        .split(':')
        .at(-1),
    );
  const servers = [];
  for (const name of ['a', 'b']) {
    phase = 'configure disposable ' + name;
    const base = 'http://127.0.0.1:' + (await port('jellyfin-' + name));
    const adminPassword = randomBytes(32).toString('base64url'),
      restrictedPassword = randomBytes(32).toString('base64url');
    secrets.push(adminPassword, restrictedPassword);
    let token;
    const api = async (path, body, authenticated = false) => {
      const response = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        signal: AbortSignal.timeout(15000),
        headers: {
          'content-type': 'application/json',
          Authorization:
            'MediaBrowser Client="OpenFlix isolated M5 verifier", Device="Fixture", DeviceId="verifier-' +
            name +
            '", Version="1"',
          ...(authenticated ? { 'X-Emby-Token': token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.ok(response.ok, 'Disposable Jellyfin status ' + response.status);
      const data = await response.text();
      return data ? JSON.parse(data) : undefined;
    };
    for (let i = 0; i < 90; i++) {
      try {
        await api('/System/Info/Public');
        break;
      } catch {
        if (i === 89) throw new Error('Jellyfin readiness');
        await delay(1000);
      }
    }
    await api('/Startup/Configuration', {
      ServerName: 'M5 independent ' + name,
      UICulture: 'en-US',
      MetadataCountryCode: 'US',
      PreferredMetadataLanguage: 'en',
    });
    await api('/Startup/User');
    await api('/Startup/User', { Name: 'fixture-admin', Password: adminPassword });
    await api('/Startup/RemoteAccess', {
      EnableRemoteAccess: true,
      EnableAutomaticPortMapping: false,
    });
    await api('/Startup/Complete', {});
    const auth = await api('/Users/AuthenticateByName', {
      Username: 'fixture-admin',
      Pw: adminPassword,
    });
    token = auth.AccessToken;
    secrets.push(token);
    const info = await api('/System/Info', undefined, true);
    assert.equal(info.Version, '10.11.11');
    for (const [section, type] of [
      ['movies', 'movies'],
      ['tv', 'tvshows'],
      ['restricted', 'movies'],
    ]) {
      await api(
        '/Library/VirtualFolders?name=' +
          section +
          '&collectionType=' +
          type +
          '&refreshLibrary=true',
        {
          LibraryOptions: {
            PathInfos: [{ Path: '/media/' + name + '/' + section }],
            EnableRealtimeMonitor: false,
            EnableInternetProviders: false,
            MetadataSavers: [],
            DisabledLocalMetadataReaders: [],
            TypeOptions: ['Movie', 'Series', 'Season', 'Episode'].map((Type) => ({
              Type,
              MetadataFetchers: [],
              ImageFetchers: [],
            })),
          },
        },
        true,
      );
    }
    let contents;
    for (let i = 0; i < 120; i++) {
      contents = await api(
        '/Users/' +
          auth.User.Id +
          '/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Fields=ProviderIds,Tags',
        undefined,
        true,
      );
      if (contents.Items.length >= 9) break;
      if (i === 119) throw new Error('Generated catalog scan timeout');
      await delay(1000);
    }
    const views = (await api('/UserViews?userId=' + auth.User.Id, undefined, true)).Items;
    const user = await api(
      '/Users/New',
      { Name: 'restricted-connector', Password: restrictedPassword },
      true,
    );
    const policy = {
      ...user.Policy,
      IsAdministrator: false,
      EnableAllFolders: false,
      EnabledFolders: views.filter((v) => v.Name !== 'restricted').map((v) => v.Id),
      EnableMediaPlayback: true,
      EnablePlaybackRemuxing: true,
      EnableAudioPlaybackTranscoding: true,
      EnableVideoPlaybackTranscoding: true,
      EnableContentDeletion: false,
      EnableRemoteAccess: true,
    };
    await api('/Users/' + user.Id + '/Policy', policy, true);
    servers.push({
      name,
      id: info.Id,
      api,
      password: restrictedPassword,
      baseUrl: 'http://jellyfin-' + name + ':8096',
    });
  }
  const backendContainers = await Promise.all(
    ['jellyfin-a', 'jellyfin-b'].map(
      async (service) =>
        JSON.parse(await run(['inspect', (await compose('ps', '-q', service)).trim()]))[0],
    ),
  );
  for (const path of ['/config', '/cache', '/media']) {
    const mounted = backendContainers.map((container) =>
      container.Mounts.find((m) => m.Destination === path),
    );
    assert.ok(mounted.every(Boolean));
    assert.notEqual(mounted[0].Name, mounted[1].Name, 'Independent backend volume: ' + path);
    if (path === '/media') assert.ok(mounted.every((m) => m.RW === false));
  }
  assert.notEqual(servers[0].id, servers[1].id);
  assert.notEqual(await port('jellyfin-a'), await port('jellyfin-b'));
  mark(
    'Two independent Jellyfin 10.11.11 identities, databases, ports and restricted connector credentials',
  );
  await run(
    ['compose', '-p', project, ...files, 'exec', '-T', 'server', 'node', '--input-type=module'],
    `import {openDatabase} from '@openflix/database';import {provisionUser} from './dist/auth.js';const db=openDatabase('/config/openflix.sqlite');await provisionUser(db,'multi-admin',${JSON.stringify(password)},'admin');await provisionUser(db,'multi-viewer',${JSON.stringify(password)},'user');db.close();`,
  );
  const web = 'http://127.0.0.1:' + (await port('web'));
  let cookie;
  const api = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const r = await fetch(web + '/api/v1' + path, {
      method,
      headers: {
        origin: env.OPENFLIX_BASE_URL,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60000),
    });
    return r;
  };
  const login = await api('/auth/login', { username: 'multi-admin', password });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  for (const server of servers) {
    const r = await api('/connectors', {
      name: 'Server ' + server.name.toUpperCase(),
      baseUrl: server.baseUrl,
      username: 'restricted-connector',
      password: server.password,
    });
    assert.equal(r.status, 201);
    server.connector = (await r.json()).connector;
    assert.equal(
      server.connector.libraries.some((l) => l.name === 'restricted'),
      false,
    );
    assert.equal((await api('/catalog/sync/' + server.connector.id, {})).status, 202);
    for (let i = 0; i < 120; i++) {
      const status = await (await api('/catalog/sync/' + server.connector.id)).json();
      if (status.state === 'successful') break;
      if (status.state === 'failed') throw new Error('Disposable catalog synchronization failed');
      if (i === 119) throw new Error('OpenFlix synchronization timeout');
      await delay(500);
    }
  }
  const movies = await (await api('/catalog/works?type=movie&limit=100')).json();
  assert.equal(movies.total, 10);
  const shared = movies.items.find((w) => w.title === 'Shared work');
  assert.ok(shared);
  assert.equal(shared.sourceCount, 2);
  assert.equal(movies.items.filter((w) => w.title === 'Same title different work').length, 2);
  assert.equal(movies.items.filter((w) => w.title === 'Conflicting evidence').length, 2);
  assert.equal(movies.items.filter((w) => w.title === 'Missing identifiers').length, 2);
  assert.equal(
    movies.items.some((w) => w.title === 'Restricted library item'),
    false,
  );
  const sources = (await (await api('/catalog/works/' + shared.id)).json()).sources.items;
  assert.equal(sources.length, 2);
  const sourceA = sources.find((s) => s.connectorId === servers[0].connector.id),
    sourceB = sources.find((s) => s.connectorId === servers[1].connector.id);
  assert.ok(sourceA && sourceB);
  assert.notEqual(sourceA.itemId, sourceB.itemId);
  const tv = await (await api('/catalog/works?type=series')).json();
  assert.equal(tv.total, 1);
  assert.equal(tv.items[0].sourceCount, 2);
  const episodes = await (
    await api('/catalog/works?type=episode&seriesWorkId=' + tv.items[0].id)
  ).json();
  assert.equal(episodes.total, 3);
  assert.equal(episodes.items.find((w) => w.title === 'Matched episode').sourceCount, 2);
  const edition = movies.items.find((w) => w.title === 'Edition choices');
  const profile = { formats: ['mp4-h264-aac', 'hls-h264-aac'] };
  assert.equal((await api('/playback/sessions', { groupId: edition.id, profile })).status, 409);
  mark(
    'Unified duplicate, unique, conflicting/missing ID, edition, restricted-library and TV hierarchy assertions',
  );
  phase = 'browser playback both servers';
  const browser = async (cases) =>
    JSON.parse(
      await run(
        ['compose', '-p', project, ...files, 'run', '--rm', '-T', 'browser'],
        JSON.stringify({ username: 'multi-admin', password, cases }),
      ),
    );
  const cases = [
    {
      title: 'Shared work',
      sourceItemId: sourceA.itemId,
      expectedItemId: sourceA.itemId,
      mode: 'direct',
    },
    {
      title: 'Shared work',
      sourceItemId: sourceB.itemId,
      expectedItemId: sourceB.itemId,
      mode: 'remux',
    },
    { title: 'Shared work', expectedItemId: sourceA.itemId, mode: 'direct' },
  ];
  const both = await browser(cases);
  assert.ok(both.passed);
  console.log(JSON.stringify(both));
  mark(
    'Actual Chromium decode/progression/pause/seek/reporting from either independent backend; automatic direct preference',
  );
  phase = 'offline startup fallback';
  await compose('stop', 'jellyfin-a');
  const fallback = await browser([
    { title: 'Shared work', expectedItemId: sourceB.itemId, mode: 'remux' },
  ]);
  assert.ok(fallback.passed);
  assert.equal((await (await api('/catalog/works/' + shared.id)).json()).work.sourceCount, 2);
  mark('Offline A remains indexed; bounded fresh planning selects and decodes B before playback');
  phase = 'connector removal';
  const removed = await api('/connectors/' + servers[0].connector.id, undefined, 'DELETE');
  assert.equal(removed.status, 200);
  const surviving = await (await api('/catalog/works/' + shared.id)).json();
  assert.equal(surviving.work.id, shared.id);
  assert.equal(surviving.work.sourceCount, 1);
  assert.equal(surviving.sources.items[0].itemId, sourceB.itemId);
  assert.ok(
    (await browser([{ title: 'Shared work', expectedItemId: sourceB.itemId, mode: 'remux' }]))
      .passed,
  );
  mark('Removing A preserves B identities, catalog and actual playback');
  phase = 'restart and isolation';
  const planned = await api('/playback/sessions', { groupId: shared.id, profile });
  assert.equal(planned.status, 201);
  const grant = await planned.json();
  await compose('up', '-d', '--force-recreate', '--wait', 'server', 'web');
  // The web port may change only when web is recreated; query inside Compose instead below.
  const recreatedWeb = 'http://127.0.0.1:' + (await port('web'));
  const fetchSaved = (path) => fetch(recreatedWeb + '/api/v1' + path, { headers: { cookie } });
  assert.equal((await fetchSaved(grant.streamPath.replace('/api/v1', ''))).status, 410);
  assert.equal(
    (await (await fetchSaved('/catalog/works/' + shared.id)).json()).work.sourceCount,
    1,
  );
  const viewerLogin = await fetch(recreatedWeb + '/api/v1/auth/login', {
    method: 'POST',
    headers: { origin: env.OPENFLIX_BASE_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'multi-viewer', password }),
  });
  assert.equal(viewerLogin.status, 200);
  const denied = await fetch(recreatedWeb + '/api/v1/playback/sessions', {
    method: 'POST',
    headers: {
      origin: env.OPENFLIX_BASE_URL,
      'content-type': 'application/json',
      cookie: viewerLogin.headers.get('set-cookie').split(';')[0],
    },
    body: JSON.stringify({ groupId: shared.id, profile }),
  });
  assert.equal(denied.status, 403);
  const logs = await compose('logs', '--no-color', 'server');
  for (const secret of secrets) assert.ok(!logs.includes(secret));
  const stats = await run([
    'stats',
    '--no-stream',
    '--format',
    '{{.MemUsage}}',
    (await compose('ps', '-q', 'server')).trim(),
  ]);
  console.log(
    JSON.stringify({
      serverMemory: stats.trim(),
      scope: 'generated short clips; historical verifier retains 4 GiB transport check',
    }),
  );
  mark(
    'Recreation preserves catalog/login, loses ephemeral grants safely, denies ordinary users and keeps logs secret-safe',
  );
  console.log(
    'Two-Jellyfin verification: ' + checks.length + '/' + checks.length + ' groups passed',
  );
} catch (error) {
  let message = error.message;
  for (const secret of secrets) message = message.replaceAll(secret, '[redacted]');
  console.error(JSON.stringify({ phase, error: message }));
  process.exitCode = 1;
} finally {
  await compose('down', '--volumes', '--remove-orphans');
}
