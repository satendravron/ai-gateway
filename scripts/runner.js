const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const procs = [];

function start(name, script, env) {
  const p = spawn(process.execPath, [path.join(ROOT, script)], {
    env: { ...process.env, ...env },
    stdio: 'inherit'
  });
  p.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
  });
  procs.push(p);
  return p;
}

function check(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', (err) => resolve({ error: err.message }));
  });
}

async function main() {
  console.log('Starting Mock A...');
  start('mock-a', 'apps/mock-providers/dist/index.js', {
    PORT: '3001', NAME: 'provider-a', BASE_LATENCY_MS: '120', JITTER_MS: '30', ERROR_RATE: '0.01'
  });

  console.log('Starting Mock B...');
  start('mock-b', 'apps/mock-providers/dist/index.js', {
    PORT: '3002', NAME: 'provider-b', BASE_LATENCY_MS: '200', JITTER_MS: '50', ERROR_RATE: '0.02'
  });

  console.log('Starting Mock C...');
  start('mock-c', 'apps/mock-providers/dist/index.js', {
    PORT: '3003', NAME: 'provider-c', BASE_LATENCY_MS: '350', JITTER_MS: '80', ERROR_RATE: '0.05'
  });

  console.log('Starting Gateway...');
  start('gateway', 'apps/gateway/dist/index.js', {
    GATEWAY_PORT: '4000',
    REDIS_URL: 'redis://127.0.0.1:6379',
    DATABASE_URL: 'postgresql://gateway:gateway@127.0.0.1:5432/gateway',
    API_KEY_SALT: 'change-me-in-production',
    PROVIDER_URLS: 'http://127.0.0.1:3001,http://127.0.0.1:3002,http://127.0.0.1:3003'
  });

  console.log('Starting Worker...');
  start('worker', 'apps/worker/dist/index.js', {
    REDIS_URL: 'redis://127.0.0.1:6379',
    DATABASE_URL: 'postgresql://gateway:gateway@127.0.0.1:5432/gateway'
  });

  console.log('Starting API...');
  start('api', 'apps/api/dist/index.js', {
    API_PORT: '4001',
    REDIS_URL: 'redis://127.0.0.1:6379',
    DATABASE_URL: 'postgresql://gateway:gateway@127.0.0.1:5432/gateway'
  });

  await new Promise(r => setTimeout(r, 4000));

  console.log('\n=== Health checks ===');
  for (const port of [3001, 3002, 3003, 4000, 4001]) {
    const res = await check(`http://127.0.0.1:${port}/health`);
    console.log(`Port ${port}:`, JSON.stringify(res));
  }
}

process.on('SIGINT', () => {
  console.log('Cleaning up child processes...');
  for (const p of procs) p.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Cleaning up child processes...');
  for (const p of procs) p.kill();
  process.exit(0);
});

main().catch(console.error);
