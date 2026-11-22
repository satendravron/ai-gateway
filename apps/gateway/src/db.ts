import { Pool } from 'pg';

export function createPool(): Pool {
  return new Pool({
    connectionString:
      process.env['DATABASE_URL'] ??
      'postgresql://gateway:gateway@localhost:5432/gateway',
    max: 10,
  });
}
