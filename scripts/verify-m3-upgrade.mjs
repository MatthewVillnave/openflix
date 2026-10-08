/** Requires the audited Git object; no network or household Jellyfin access. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = '411c2527c164115a639b3aebc72de691eec3613e';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
assert.equal(
  git('diff', baseline, '--', 'packages/database').trim(),
  '',
  'M4 must preserve audited database source',
);
const directory = mkdtempSync(join(tmpdir(), 'openflix-m3-upgrade-'));
try {
  const source = join(directory, 'audited');
  mkdirSync(source, { mode: 0o700 });
  writeFileSync(join(source, 'package.json'), '{"type":"module"}');
  symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
  const files = git('ls-tree', '-r', '--name-only', baseline, 'packages/database/src')
    .trim()
    .split('\n');
  for (const file of files)
    writeFileSync(join(source, file.split('/').at(-1)), git('show', `${baseline}:${file}`));
  const script = `
    import assert from 'node:assert/strict';
    import {randomBytes} from 'node:crypto';
    import {openDatabase,catalogId} from './audited/index.ts';
    import {loadConfig} from ${JSON.stringify(join(root, 'apps/server/dist/config.js'))};
    import {buildApp} from ${JSON.stringify(join(root, 'apps/server/dist/app.js'))};
    import {tokenDigest} from ${JSON.stringify(join(root, 'apps/server/dist/auth.js'))};
    import {EncryptedCredentialStore} from ${JSON.stringify(join(root, 'apps/server/dist/connector-credentials.js'))};
    import {createRequire} from 'node:module';
    const Database=createRequire(${JSON.stringify(join(root, 'package.json'))})('better-sqlite3');
    const config=loadConfig({NODE_ENV:'test',OPENFLIX_DATA_DIR:${JSON.stringify(join(directory, 'data'))},OPENFLIX_MASTER_KEY:randomBytes(32).toString('base64'),OPENFLIX_LOG_LEVEL:'silent'});
    const db=openDatabase(config.databasePath),now=Date.now(),token=randomBytes(32).toString('base64url');
    db.createUser({id:'upgrade-admin',username:'upgrade-admin',displayName:'Upgrade',role:'admin',passwordHash:'synthetic-test-only'},now);
    db.createSession(tokenDigest(token),'upgrade-admin',now,now+3600000);
    const vault=new EncryptedCredentialStore(db,config.masterKey);
    const secret=Buffer.from('synthetic-upgrade-secret');
    vault.create({id:'upgrade-source',name:'Upgrade source',type:'jellyfin',baseUrl:'https://fixture.invalid',server:{id:'server',name:'Fixture',version:'10.11.11'},libraries:[],state:'connected',createdAt:now,lastError:null,lastCheckedAt:null},secret);
    const run=db.catalog.begin('upgrade-source',null);
    db.catalog.stageLibrary(run,{id:'library',name:'Upgrade library',type:'movie',mediaTypes:['movie']});
    db.catalog.stagePage(run,'library',[{id:'movie',libraryId:'library',type:'movie',title:'Preserved movie',providerIds:{}}]);
    db.catalog.publish(run);
    const envelope=db.getConnector('upgrade-source').credentialEnvelope;
    vault.destroy();db.close();
    const raw=new Database(config.databasePath);const ledger=raw.prepare('SELECT * FROM schema_migrations ORDER BY version').all();raw.close();
    const app=await buildApp(config);
    try {
      const headers={cookie:config.cookieName+'='+token};
      assert.equal((await app.inject({url:'/api/v1/me',headers})).statusCode,200);
      const response=await app.inject({url:'/api/v1/catalog/items/'+catalogId('item','upgrade-source','movie'),headers});
      assert.equal(response.statusCode,200);assert.equal(response.json().item.title,'Preserved movie');
      const current=openDatabase(config.databasePath);assert.equal(current.getConnector('upgrade-source').credentialEnvelope,envelope);
      const reopened=new EncryptedCredentialStore(current,config.masterKey);assert.deepEqual(Buffer.from(await reopened.read({id:'upgrade-source'})),secret);reopened.destroy();current.close();
      const check=new Database(config.databasePath);assert.deepEqual(check.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),ledger);assert.equal(check.pragma('integrity_check',{simple:true}),'ok');check.close();
    } finally {await app.close();secret.fill(0);}
    console.log('PASS audited M3 database -> M4 startup: users, login, encrypted secret, catalog IDs, migration ledger and integrity');
  `;
  writeFileSync(join(directory, 'verify.mjs'), script);
  const output = execFileSync(
    process.execPath,
    ['--import', join(root, 'node_modules/tsx/dist/loader.mjs'), join(directory, 'verify.mjs')],
    { cwd: root, encoding: 'utf8', timeout: 30000 },
  );
  process.stdout.write(output);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
