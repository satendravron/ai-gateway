const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://gateway:gateway@127.0.0.1:5432/gateway' });

async function check() {
  const logs = await pool.query('SELECT count(*), provider, cache_hit FROM request_logs GROUP BY provider, cache_hit;');
  console.log('request_logs count by provider & cache_hit:', logs.rows);
  const stats = await pool.query('SELECT * FROM provider_stats_1m;');
  console.log('provider_stats_1m rows:', stats.rows.length);
  await pool.end();
}

check().catch(console.error);
