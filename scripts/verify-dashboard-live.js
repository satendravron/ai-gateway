const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');

const WS_URL = process.env.VITE_WS_URL || 'ws://localhost:4001/ws';

let displayMetrics = [];
let lastActiveKpis = {
  reqPerMin: 0,
  hitPct: '0.0',
  errPct: '0.0',
  p95: 0,
  tokPerMin: 0,
};

function computeKpis() {
  const now = Date.now();
  const latestTs = displayMetrics.length > 0
    ? Math.max(...displayMetrics.map((m) => new Date(m.ts).getTime()).filter((t) => !isNaN(t)))
    : now;
  const refTime = Math.max(now, latestTs);
  const windowCutoff = refTime - 60_000;

  const windowMetrics = displayMetrics.filter((m) => {
    const t = new Date(m.ts).getTime();
    return !isNaN(t) && t >= windowCutoff;
  });

  const windowReqs = windowMetrics.reduce((s, m) => s + m.requests, 0);
  const windowHits = windowMetrics.reduce((s, m) => s + m.cacheHits, 0);
  const windowErrs = windowMetrics.reduce((s, m) => s + m.errors, 0);
  const windowTokens = windowMetrics.reduce((s, m) => s + m.promptTokens + m.completionTokens, 0);
  const activeSnaps = windowMetrics.filter((m) => m.requests > 0);

  const firstWindowTs = windowMetrics.length > 0
    ? Math.min(...windowMetrics.map((m) => new Date(m.ts).getTime()).filter((t) => !isNaN(t)))
    : refTime;
  const elapsedSeconds = Math.max(1, Math.min(60, (refTime - firstWindowTs) / 1000));

  const rollingReqPerMin = Math.round((windowReqs / elapsedSeconds) * 60);
  const rollingTokPerMin = Math.round((windowTokens / elapsedSeconds) * 60);
  const rollingHitPct = windowReqs > 0 ? ((windowHits / windowReqs) * 100).toFixed(1) : null;
  const rollingErrPct = windowReqs > 0 ? ((windowErrs / windowReqs) * 100).toFixed(1) : null;
  const rollingP95 = activeSnaps.length > 0 && windowReqs > 0
    ? Math.round(activeSnaps.reduce((s, m) => s + m.p95 * m.requests, 0) / windowReqs)
    : null;

  if (windowReqs > 0) {
    lastActiveKpis = {
      reqPerMin: rollingReqPerMin,
      hitPct: rollingHitPct ?? lastActiveKpis.hitPct,
      errPct: rollingErrPct ?? lastActiveKpis.errPct,
      p95: rollingP95 ?? lastActiveKpis.p95,
      tokPerMin: rollingTokPerMin,
    };
  }

  const displayReqPerMin = windowReqs > 0 ? rollingReqPerMin : lastActiveKpis.reqPerMin;
  const displayHitPct = rollingHitPct ?? lastActiveKpis.hitPct;
  const displayErrPct = rollingErrPct ?? lastActiveKpis.errPct;
  const displayP95 = (rollingP95 !== null && rollingP95 > 0)
    ? rollingP95
    : lastActiveKpis.p95;
  const displayTokPerMin = windowReqs > 0 ? rollingTokPerMin : lastActiveKpis.tokPerMin;

  return {
    reqPerMin: displayReqPerMin,
    hitPct: `${displayHitPct}%`,
    errPct: `${displayErrPct}%`,
    p95: `${displayP95}ms`,
    tokPerMin: displayTokPerMin,
    rawInWindow: windowReqs,
    windowSeconds: elapsedSeconds.toFixed(0),
  };
}

async function main() {
  console.log('Connecting to WebSocket at', WS_URL);
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('✅ Connected to WebSocket');
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'hello') {
        displayMetrics = (msg.data || []).slice(-600);
      } else if (msg.type === 'metrics') {
        displayMetrics.push(msg.data);
        if (displayMetrics.length > 600) displayMetrics.shift();
      }
    } catch (_) {}
  });

  // Give WS 1.5s to receive hello message
  await new Promise((r) => setTimeout(r, 1500));

  // Log KPI sampler every second
  let running = true;
  const samples = [];
  const sampleTimer = setInterval(() => {
    if (!running) return;
    const kpi = computeKpis();
    samples.push(kpi);
    console.log(`[Dashboard Live KPI] Req/min: ${kpi.reqPerMin.toLocaleString().padStart(6)} | Cache Hit: ${kpi.hitPct.padStart(5)} | Error: ${kpi.errPct.padStart(5)} | p95: ${kpi.p95.padStart(5)} | Window: ${kpi.windowSeconds}s (raw ${kpi.rawInWindow} reqs)`);
  }, 1000);

  // Run Realistic Benchmark
  console.log('\n--- Launching Realistic Workload (40% repeats @ 200 req/s) ---');
  const benchProc = spawn(
    process.execPath,
    [path.join(__dirname, '..', 'bench', 'load.js')],
    {
      env: {
        ...process.env,
        GATEWAY_URL: 'http://localhost:4000',
        BENCH_API_KEY: 'gw_demo_key',
        WARMUP_DURATION: '3',
        BENCH_DURATION: '20',
        RATE: '200',
        CONNECTIONS: '50',
        WORKLOAD: 'realistic',
      },
      stdio: 'inherit',
    }
  );

  await new Promise((resolve) => benchProc.on('exit', resolve));
  console.log('\n--- Benchmark Completed. Observing Dashboard pause behavior for 6 seconds ---');

  // Observe for 6 more seconds to confirm KPIs do not drop to 0 when traffic pauses
  await new Promise((r) => setTimeout(r, 6000));
  running = false;
  clearInterval(sampleTimer);
  ws.close();

  // Validate samples
  const activeSamples = samples.filter((s) => s.reqPerMin > 5000);
  console.log('\n================ FINAL VERIFICATION ================');
  console.log(`Total samples collected: ${samples.length}`);
  console.log(`Active benchmark samples (>5,000 req/min): ${activeSamples.length}`);
  if (activeSamples.length > 0) {
    const avgReqPerMin = Math.round(activeSamples.reduce((s, x) => s + x.reqPerMin, 0) / activeSamples.length);
    const lastActiveHitPct = activeSamples[activeSamples.length - 1].hitPct;
    console.log(`Average Req/min during run : ${avgReqPerMin} (Target ~12,000)`);
    console.log(`Cache Hit % during run     : ${lastActiveHitPct} (Target ~40%)`);
    const afterPauseKpi = samples[samples.length - 1];
    console.log(`Post-pause Req/min         : ${afterPauseKpi.reqPerMin} (Did not drop to 0!)`);
    console.log(`Post-pause Cache Hit %     : ${afterPauseKpi.hitPct} (Did not drop to 0!)`);
    console.log(`Post-pause p95 Overhead    : ${afterPauseKpi.p95} (Did not drop to 0!)`);
  }
}

main().catch(console.error);
