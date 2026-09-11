import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import dotenv from 'dotenv';
import pg from 'pg';

const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('Pass absolute runtime root');
const runtime = path.join(root, 'runtime');
const saved = path.join(root, 'backups', '2026-09-11-before-local');
const bin = path.join(runtime, 'pgsql', 'bin');
const cloud = dotenv.parse(fs.readFileSync(path.join(saved, 'render.env')));
const run = (tool, args, env = {}) => {
  const result = spawnSync(path.join(bin, tool + '.exe'), args, {
    env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true,
    ...(tool === 'pg_ctl' ? { stdio: 'ignore' } : {}),
  });
  if (result.status !== 0) throw new Error(`${tool}: ${result.stderr || result.error}`);
  return result.stdout;
};
const pgEnv = (uri) => {
  const url = new URL(uri);
  return { PGHOST: url.hostname, PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1), PGSSLMODE: url.hostname === 'localhost' ? 'disable' : 'require',
    PGCONNECT_TIMEOUT: '30' };
};
async function tableCounts(uri) {
  const client = new pg.Client({ connectionString: uri, ssl: uri.includes('localhost') ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const counts = {};
    for (const { tablename } of tables.rows) {
      const result = await client.query(`SELECT count(*)::int AS count FROM public."${tablename.replaceAll('"', '""')}"`);
      counts[tablename] = result.rows[0].count;
    }
    return counts;
  } finally { await client.end(); }
}

if (process.argv.includes('--backup-sqlite')) {
  const source = path.resolve('src/data/navpedagoga.sqlite');
  const target = path.join(saved, 'old-local.sqlite');
  if (!fs.existsSync(target)) {
    const sqlite = new DatabaseSync(source);
    await backup(sqlite, target);
    sqlite.close();
  }
  console.log('SQLite online backup complete');
  process.exit(0);
}

const dumpFile = path.join(saved, 'supabase-public.dump');
if (!fs.existsSync(dumpFile)) {
  run('pg_dump', ['--format=custom', '--schema=public', '--no-owner', '--no-privileges', '--file=' + dumpFile + '.partial'], pgEnv(cloud.DATABASE_URL));
  fs.renameSync(dumpFile + '.partial', dumpFile);
}
run('pg_restore', ['--list', dumpFile]);
const counts = await tableCounts(cloud.DATABASE_URL);
fs.writeFileSync(path.join(saved, 'cloud-counts.json'), JSON.stringify(counts, null, 2));
console.log('Cloud backup validated:', Object.keys(counts).length, 'tables');

const localEnv = path.join(runtime, 'server.env');
if (fs.existsSync(localEnv)) throw new Error('Local config exists; refusing to reinitialize');
const passwordFile = path.join(runtime, 'postgres-password.txt');
const initialized = fs.existsSync(path.join(runtime, 'pgdata', 'PG_VERSION'));
const adminPassword = initialized ? fs.readFileSync(passwordFile, 'utf8') : crypto.randomBytes(32).toString('hex');
const appPassword = crypto.randomBytes(32).toString('hex');
if (!initialized) {
fs.writeFileSync(passwordFile, adminPassword);
run('initdb', ['-D', path.join(runtime, 'pgdata'), '-U', 'postgres', '--pwfile=' + passwordFile,
  '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
fs.appendFileSync(path.join(runtime, 'pgdata', 'postgresql.conf'), "\nlisten_addresses = 'localhost'\nport = 5433\nmax_connections = 60\n");
run('pg_ctl', ['-D', path.join(runtime, 'pgdata'), '-l', path.join(runtime, 'postgres.log'), '-w', 'start']);
}
const adminUri = `postgresql://postgres:${adminPassword}@localhost:5433/postgres`;
const admin = new pg.Client({ connectionString: adminUri });
await admin.connect();
await admin.query(`CREATE ROLE npapp LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
await admin.query('CREATE DATABASE navigator OWNER npapp');
await admin.end();
const localUri = `postgresql://npapp:${appPassword}@localhost:5433/navigator`;
run('pg_restore', ['--dbname=navigator', '--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', dumpFile], pgEnv(localUri));
const restored = await tableCounts(localUri);
if (JSON.stringify(counts) !== JSON.stringify(restored)) throw new Error('Restored counts differ; stop before publishing');
const config = { ...cloud, DATABASE_URL: localUri, PORT: '4100', HOST: '127.0.0.1', NODE_ENV: 'production',
  CORS_ORIGIN: 'https://vsnp-moscow.github.io,http://localhost:4100,http://127.0.0.1:4100',
  SMARTAPI_BASE_URL: 'https://api.smartapi.shop/v1', SMARTAPI_MODEL: 'gpt-5.6-luna', SMTP_ENABLED: 'false' };
fs.writeFileSync(localEnv, Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n');
fs.writeFileSync(path.join(runtime, 'postgres-admin.env'), `DATABASE_URL=${adminUri}\n`);
fs.writeFileSync(path.join(saved, 'restore-verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), restored }, null, 2));
const hashes = Object.fromEntries(fs.readdirSync(saved).filter(f => fs.statSync(path.join(saved, f)).isFile()).map(f =>
  [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(saved, f))).digest('hex')]));
fs.writeFileSync(path.join(saved, 'SHA256.json'), JSON.stringify(hashes, null, 2));
console.log('Restored all tables successfully to local PostgreSQL');
