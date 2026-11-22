const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://gateway:gateway@127.0.0.1:5432/gateway' });
pool.query('ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS retry_ms INT NOT NULL DEFAULT 0;').then(() => {
  console.log('ALTER TABLE SUCCESS');
  return pool.end();
}).catch((err) => {
  console.error('ALTER TABLE ERROR:', err.message);
  process.exit(1);
});
