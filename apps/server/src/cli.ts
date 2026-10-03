import { password } from '@inquirer/prompts';
import { openDatabase } from '@openflix/database';
import { loadConfig } from './config.js';
import { provisionUser } from './auth.js';
process.umask(0o077);
let db: ReturnType<typeof openDatabase> | undefined;
try {
  const [command, username, roleFlag, ...extra] = process.argv.slice(2);
  if (command !== 'db:migrate' && command !== 'user:create') throw new Error('Unknown command');
  if (command === 'user:create' && (!username || (roleFlag && roleFlag !== '--admin') || extra.length || !process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error('Usage: user:create <username> [--admin], from an interactive terminal');
  }
  db = openDatabase(loadConfig().databasePath);
  if (command === 'user:create') {
    const secret = await password({ message: 'Password (12+ characters):' });
    const confirmation = await password({ message: 'Confirm password:' });
    if (secret !== confirmation) throw new Error('Passwords differ');
    await provisionUser(db, username!, secret, roleFlag === '--admin' ? 'admin' : 'user');
    console.log('Account created.');
  } else { console.log('Database migrations applied.'); }
} catch {
  console.error('Command failed. Check arguments, unique username, password requirements/confirmation, configuration, and database permissions.');
  process.exitCode = 1;
} finally { db?.close(); }
