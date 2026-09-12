import { readFile } from 'node:fs/promises';
import pg from 'pg';
const { Pool } = pg;

async function check() {
  const envPaths = [
    new URL('./.vscode/.env.txt', import.meta.url),
    new URL('./.env.txt', import.meta.url),
    new URL('./.env', import.meta.url),
  ];
  let dbUrl = process.env.DATABASE_URL;
  for (const envPath of envPaths) {
    try {
      const contents = await readFile(envPath, 'utf8');
      for (const line of contents.split(/\r?\n/)) {
        if (line.startsWith('DATABASE_URL=')) dbUrl = line.split('=')[1].trim().replace(/^['"]|['"]$/g, '');
      }
    } catch {}
  }
  console.log('DATABASE_URL configured:', !!dbUrl);
  if (dbUrl) {
    try {
      const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
      const res = await pool.query('SELECT accounts FROM app_state WHERE id = 1');
      const list = res.rows[0]?.accounts || [];
      console.log('ACCOUNTS_COUNT:' + list.length);
      console.log('CODENAMES:' + JSON.stringify(list.map(a => a.codename)));
      await pool.end();
    } catch (e) {
      console.log('DB_ERROR:' + e.message);
    }
  } else {
    try {
      const localAccounts = JSON.parse(await readFile(new URL('./accounts.json', import.meta.url), 'utf8'));
      console.log('ACCOUNTS_COUNT:' + localAccounts.length);
      console.log('CODENAMES:' + JSON.stringify(localAccounts.map(a => a.codename)));
    } catch (e) {
      console.log('FILE_ERROR:' + e.message);
    }
  }
}
check();
