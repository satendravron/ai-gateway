const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://gateway:gateway@127.0.0.1:5432/gateway'
});

async function main() {
  try {
    console.log('Connecting to PostgreSQL...');
    const initSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf-8');
    await pool.query(initSql);
    console.log('init.sql executed successfully.');

    // Also explicitly ensure correct demo key is present
    await pool.query(`
      INSERT INTO api_keys (name, key_hash, rate_limit_per_min)
      VALUES ('demo', 'cca350b1f05766b5b174381222fa8568b4e3b1a545a23239226dab756dd2a806', 6000)
      ON CONFLICT (key_hash) DO NOTHING;
    `);

    const res = await pool.query('SELECT * FROM api_keys;');
    console.log('api_keys rows:', res.rows);

    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update('gw_demo_key').digest('hex');
    console.log('sha256(gw_demo_key) =', hash);

    const match = res.rows.find(r => r.key_hash === hash);
    console.log('Matching key found:', match ? 'YES (id=' + match.id + ')' : 'NO');
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
