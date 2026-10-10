/** Requires the audited Git object; no network or household Jellyfin access. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = 'e975e3bd38cb3627b2fa3053bdb3e137c4450764';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
assert.equal(
  git('diff', baseline, '--', 'packages/database/src/storage.ts').trim(),
  '',
  'M5 preserves audited private-storage enforcement',
);
const directory = mkdtempSync(join(tmpdir(), 'openflix-m4-upgrade-'));
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
    import {openDatabase as auditedDatabase,catalogId} from './audited/index.ts';
    import {openDatabase} from ${JSON.stringify(join(root, 'packages/database/dist/index.js'))};
    import {loadConfig} from ${JSON.stringify(join(root, 'apps/server/dist/config.js'))};
    import {buildApp} from ${JSON.stringify(join(root, 'apps/server/dist/app.js'))};
    import {tokenDigest} from ${JSON.stringify(join(root, 'apps/server/dist/auth.js'))};
    import {EncryptedCredentialStore} from ${JSON.stringify(join(root, 'apps/server/dist/connector-credentials.js'))};
    import {createRequire} from 'node:module';
    const Database=createRequire(${JSON.stringify(join(root, 'package.json'))})('better-sqlite3');
    const config=loadConfig({NODE_ENV:'test',OPENFLIX_DATA_DIR:${JSON.stringify(join(directory, 'data'))},OPENFLIX_MASTER_KEY:randomBytes(32).toString('base64'),OPENFLIX_LOG_LEVEL:'silent'});
    const db=auditedDatabase(config.databasePath),now=Date.now(),token=randomBytes(32).toString('base64url');
    db.createUser({id:'upgrade-admin',username:'upgrade-admin',displayName:'Upgrade',role:'admin',passwordHash:'synthetic-test-only'},now);
    db.createSession(tokenDigest(token),'upgrade-admin',now,now+3600000);
    const vault=new EncryptedCredentialStore(db,config.masterKey);
    const secret=Buffer.from('synthetic-upgrade-secret');
    vault.create({id:'upgrade-source',name:'Upgrade source',type:'jellyfin',baseUrl:'https://fixture.invalid',server:{id:'server',name:'Fixture',version:'10.11.11'},libraries:[],state:'connected',createdAt:now,lastError:null,lastCheckedAt:null},secret);
    const run=db.catalog.begin('upgrade-source',null);
    db.catalog.stageLibrary(run,{id:'library',name:'Upgrade library',type:'movie',mediaTypes:['movie']});
    db.catalog.stagePage(run,'library',[{id:'movie',libraryId:'library',type:'movie',title:'Preserved movie',providerIds:{Tmdb:'123'}}]);
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
      const check=new Database(config.databasePath);const updated=check.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
      assert.deepEqual(updated.slice(0,3),ledger);assert.equal(updated.length,4);
      assert.equal(check.prepare('SELECT COUNT(*) AS n FROM catalog_work_members').get().n,1);
      const unified=await app.inject({url:'/api/v1/catalog/works',headers});
      assert.equal(unified.statusCode,200);assert.equal(unified.json().items[0].title,'Preserved movie');assert.equal(check.pragma('integrity_check',{simple:true}),'ok');check.close();
    } finally {await app.close();secret.fill(0);}
    console.log('PASS audited M4 database -> M5 startup: users, login, encrypted secret, catalog IDs, migration ledger and integrity');
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
