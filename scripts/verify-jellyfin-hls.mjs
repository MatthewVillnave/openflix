/** Creates only a new disposable test project. Never accepts a household server URL. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const project = `openflix-hls-r2-${process.pid}-${randomBytes(4).toString('hex')}`;
const password = randomBytes(32).toString('base64url');
const upstreamPassword = randomBytes(32).toString('base64url');
const key = randomBytes(32).toString('base64');
const env = {
  ...process.env,
  OPENFLIX_BASE_URL: 'https://localhost:8443',
  OPENFLIX_MASTER_KEY: key,
};
const files = ['-f', 'docker-compose.yml', '-f', 'docker/compose.hls.verify.yml'];
const run = (args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      args,
      { env, maxBuffer: 32 * 1024 * 1024, timeout: args.includes('build') ? 1200000 : 180000 },
      (err, out, stderr) =>
        err
          ? reject(
              new Error(
                `Disposable Docker operation failed: ${stderr.slice(-2000)} ${out.slice(-1000)}`,
              ),
            )
          : resolve(out),
    );
    child.stdin.end(input);
  });
const compose = (...args) => run(['compose', '-p', project, ...files, ...args]);
const mark = (message) => console.log(`PASS ${message}`);
let token;
try {
  console.log('Building disposable Jellyfin HLS images');
  await compose('build', 'server', 'web', 'jellyfin-real', 'hls-media', 'browser');
  console.log('Starting disposable Jellyfin HLS stack');
  await compose('up', '-d', '--wait', 'server', 'web', 'jellyfin-real', 'hls-media');
  const port = async (service, target) =>
    Number((await compose('port', service, String(target))).trim().split(':').at(-1));
  const jellyfin = `http://127.0.0.1:${await port('jellyfin-real', 8096)}`;
  const web = `http://127.0.0.1:${await port('web', 8080)}`;
  async function api(path, body, auth = false, method = body === undefined ? 'GET' : 'POST') {
    const res = await fetch(jellyfin + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(auth ? { 'X-Emby-Token': token } : {}),
        Authorization:
          'MediaBrowser Client="OpenFlix disposable verifier", Device="Fixture", DeviceId="disposable-verifier", Version="1"',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    assert.ok(res.ok, `Disposable Jellyfin ${path.split('?')[0]} status ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }
  for (let n = 0; n < 90; n++) {
    try {
      await api('/System/Info/Public');
      break;
    } catch {
      if (n === 89) throw new Error('Disposable Jellyfin readiness timeout');
      await delay(1000);
    }
  }
  await api('/Startup/Configuration', {
    ServerName: 'OpenFlix disposable Jellyfin',
    UICulture: 'en-US',
    MetadataCountryCode: 'US',
    PreferredMetadataLanguage: 'en',
  });
  await api('/Startup/User');
  await api('/Startup/User', { Name: 'fixture-admin', Password: upstreamPassword });
  await api('/Startup/RemoteAccess', {
    EnableRemoteAccess: true,
    EnableAutomaticPortMapping: false,
  });
  await api('/Startup/Complete', {});
  const auth = await api('/Users/AuthenticateByName', {
    Username: 'fixture-admin',
    Pw: upstreamPassword,
  });
  token = auth.AccessToken;
  const info = await api('/System/Info', undefined, true);
  assert.equal(info.Version, '10.11.11');
  await api(
    '/Library/VirtualFolders?name=Generated&collectionType=movies&refreshLibrary=true',
    {
      LibraryOptions: {
        PathInfos: [{ Path: '/media/generated' }],
        EnableRealtimeMonitor: false,
        EnableInternetProviders: false,
        MetadataSavers: [],
        DisabledLocalMetadataReaders: [],
        TypeOptions: [{ Type: 'Movie', MetadataFetchers: [], ImageFetchers: [] }],
      },
    },
    true,
  );
  for (let n = 0; n < 120; n++) {
    const items = await api(
      `/Users/${auth.User.Id}/Items?Recursive=true&IncludeItemTypes=Movie`,
      undefined,
      true,
    );
    if (items.Items.length === 5) break;
    if (n === 119) throw new Error('Generated library scan timeout');
    await delay(1000);
  }
  mark('Real disposable Jellyfin 10.11.11 with five generated sources');
  const generated = await api(
    `/Users/${auth.User.Id}/Items?Recursive=true&IncludeItemTypes=Movie`,
    undefined,
    true,
  );
  const subtitleItem = generated.Items.find((item) => item.Name === 'Subtitle Fixture');
  assert.ok(subtitleItem, 'Missing generated subtitle item');
  const metadata = await api(
    `/Items/${subtitleItem.Id}/PlaybackInfo?UserId=${auth.User.Id}`,
    { UserId: auth.User.Id, IsPlayback: false, AutoOpenLiveStream: false },
    true,
  );
  const subtitle = metadata.MediaSources.flatMap((source) => source.MediaStreams ?? []).find(
    (stream) => stream.Type === 'Subtitle',
  );
  assert.ok(subtitle, 'Generated MKV must expose an actual subtitle stream');
  for (const field of ['Width', 'Height'])
    assert.ok(
      subtitle[field] == null || subtitle[field] === 0,
      'Unexpected generated subtitle dimension',
    );
  console.log(
    JSON.stringify({
      subtitleShape: {
        Type: subtitle.Type,
        Width: subtitle.Width ?? null,
        Height: subtitle.Height ?? null,
      },
    }),
  );
  mark(
    'Actual subtitle metadata conforms to nullable/non-video dimensions; exact zero shape also covered by contract fixture',
  );

  const source = `import {openDatabase} from '@openflix/database';import {provisionUser} from './dist/auth.js';const db=openDatabase('/config/openflix.sqlite');await provisionUser(db,'hls-admin',${JSON.stringify(password)},'admin');await provisionUser(db,'hls-viewer',${JSON.stringify(password)},'user');db.close();`;
  await run(
    ['compose', '-p', project, ...files, 'exec', '-T', 'server', 'node', '--input-type=module'],
    source,
  );
  const serverId = (await compose('ps', '-q', 'server')).trim();
  const beforeStats = JSON.parse(
    (await run(['stats', '--no-stream', '--format', '{{json .}}', serverId])).trim(),
  );
  const result = JSON.parse(
    await run(
      ['compose', '-p', project, ...files, 'run', '--rm', '-T', 'browser'],
      JSON.stringify({
        username: 'hls-admin',
        password,
        realHls: true,
        jellyfin: {
          baseUrl: 'http://jellyfin-real:8096',
          username: 'fixture-admin',
          password: upstreamPassword,
        },
      }),
    ),
  );
  assert.ok(result.passed);
  assert.equal(result.playback.length, 5);
  const afterStats = JSON.parse(
    (await run(['stats', '--no-stream', '--format', '{{json .}}', serverId])).trim(),
  );
  console.log(
    JSON.stringify({
      resource: {
        before: beforeStats.MemUsage,
        after: afterStats.MemUsage,
        limit: 'bounded segment transport; full 4 GiB check in preserved verifier',
      },
    }),
  );
  console.log(JSON.stringify(result));
  mark(
    'Direct MP4 and real MKV remux/audio/video conversion decode, pause and seek through authenticated OpenFlix HLS',
  );
  // Independently inspect actual FFmpeg commands in this synthetic disposable server, returning booleans only.
  const commands = await compose(
    'exec',
    '-T',
    'jellyfin-real',
    'sh',
    '-c',
    'cat /config/log/FFmpeg* 2>/dev/null || true',
  );
  const encodingEvidence = [];
  for (const [title, videoCopy, audioCopy] of [
    ['Remux Fixture', true, true],
    ['Subtitle Fixture', true, true],
    ['Audio Conversion Fixture', true, false],
    ['Video Conversion Fixture', false, true],
  ]) {
    const command = commands
      .split('\n')
      .find((line) => line.includes(title + '.mkv') && line.includes('-codec:v:0'));
    assert.ok(command, `Missing generated ${title} FFmpeg evidence`);
    assert.equal(/-codec:v:0 copy/.test(command), videoCopy, `${title} video method`);
    assert.equal(/-codec:a:0 copy/.test(command), audioCopy, `${title} audio method`);
    if (!videoCopy)
      assert.ok(/-codec:v:0 libx264/.test(command), 'Missing software H264 conversion evidence');
    if (!audioCopy)
      assert.ok(/-codec:a:0 (?:aac|libfdk_aac)/.test(command), 'Missing AAC conversion evidence');
    encodingEvidence.push({ title, videoCopy, audioCopy });
  }
  console.log(JSON.stringify({ encodingEvidence }));
  await delay(1000);
  await compose(
    'exec',
    '-T',
    'jellyfin-real',
    'sh',
    '-c',
    'for path in /proc/[0-9]*/comm; do read name < "$path" || continue; if [ "$name" = ffmpeg ]; then exit 1; fi; done',
  );
  mark('Jellyfin FFmpeg evidence confirms video/audio copy and software re-encoding');
  const login = await fetch(web + '/api/v1/auth/login', {
    method: 'POST',
    headers: { origin: env.OPENFLIX_BASE_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'hls-viewer', password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const denied = await fetch(web + '/api/v1/playback/sessions', {
    method: 'POST',
    headers: { origin: env.OPENFLIX_BASE_URL, 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      itemId: 'item_' + '0'.repeat(64),
      profile: { formats: ['hls-h264-aac'] },
    }),
  });
  assert.equal(denied.status, 403);
  mark('Ordinary user denied; browser verified logout and new-login grant rejection');
  const loginAdmin = async () => {
    const r = await fetch(web + '/api/v1/auth/login', {
      method: 'POST',
      headers: { origin: env.OPENFLIX_BASE_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'hls-admin', password }),
    });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const adminCookie = await loginAdmin();
  const saved = await (
    await fetch(web + '/api/v1/connectors', { headers: { cookie: adminCookie } })
  ).json();
  assert.equal(saved.connectors.length, 1);
  const testSaved = async () => {
    const r = await fetch(web + `/api/v1/connectors/${saved.connectors[0].id}/test`, {
      method: 'POST',
      headers: {
        cookie: adminCookie,
        origin: env.OPENFLIX_BASE_URL,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(r.status, 200);
  };
  await compose('restart', 'server');
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const r = await fetch(web + '/health', { signal: AbortSignal.timeout(2000) });
      if (r.ok) break;
    } catch {}
    if (attempt === 29) throw new Error('OpenFlix restart readiness timeout');
    await delay(1000);
  }
  await testSaved();
  await compose('up', '-d', '--force-recreate', 'server');
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const r = await fetch(web + '/health', { signal: AbortSignal.timeout(2000) });
      if (r.ok) break;
    } catch {}
    if (attempt === 29) throw new Error('OpenFlix restart readiness timeout');
    await delay(1000);
  }
  assert.equal((await fetch(web + '/health')).status, 200);
  await testSaved();
  const removed = await fetch(web + `/api/v1/connectors/${saved.connectors[0].id}`, {
    method: 'DELETE',
    headers: { cookie: adminCookie, origin: env.OPENFLIX_BASE_URL },
  });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).revocation, 'confirmed');
  const logs = await compose('logs', '--no-color', 'server');
  for (const secret of [password, upstreamPassword, token, key]) assert.ok(!logs.includes(secret));
  mark('Restart/recreation and secret-safe OpenFlix logs');
  console.log('Real Jellyfin HLS verification: 5/5 groups passed');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await compose('down', '--volumes', '--remove-orphans');
}
