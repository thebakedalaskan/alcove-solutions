import { loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrate';

/** `pnpm migrate` locally; a one-off Cloud Run job in production. */
const pool = createPool(loadConfig().DATABASE_URL);
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await pool.end();
}
