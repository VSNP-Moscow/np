import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('Pass absolute runtime root');
const runtime = path.join(root, 'runtime');
const config = dotenv.parse(fs.readFileSync(path.join(runtime, 'server.env')));
const url = new URL(config.DATABASE_URL);
const backupDir = path.join(root, 'backups', 'daily');
fs.mkdirSync(backupDir, { recursive: true });
const dest = path.join(backupDir, new Date().toISOString().slice(0, 10) + '.dump');
if (!fs.existsSync(dest)) {
  const result = spawnSync(path.join(runtime, 'pgsql/bin/pg_dump.exe'),
    ['--format=custom', '--schema=public', '--no-owner', '--no-privileges', '--file=' + dest + '.partial'], {
      windowsHide: true, encoding: 'utf8', env: { ...process.env,
        PGHOST: url.hostname, PGPORT: url.port, PGUSER: url.username, PGPASSWORD: url.password,
        PGDATABASE: url.pathname.slice(1), PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '10' },
    });
  if (result.status !== 0) throw new Error(result.stderr || 'Backup failed');
  fs.renameSync(dest + '.partial', dest);
  console.log('Backup complete:', dest);
}
