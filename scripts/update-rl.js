const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://gateway:gateway@127.0.0.1:5432/gateway' });
pool.query('UPDATE api_keys SET rate_limit_per_min = 60000;').then(() => {
  console.log('Updated rate limit to 60000 in DB');
  return pool.end();
}).catch(console.error);
