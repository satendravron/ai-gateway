"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const autocannon_1 = __importDefault(require("autocannon"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000';
const API_KEY = process.env['BENCH_API_KEY'] ?? 'gw_demo_key';
const WARMUP_DURATION = parseInt(process.env['WARMUP_DURATION'] ?? '5', 10);
const BENCH_DURATION = parseInt(process.env['BENCH_DURATION'] ?? '25', 10);
const CONNECTIONS = parseInt(process.env['CONNECTIONS'] ?? '50', 10);
const RATE = parseInt(process.env['RATE'] ?? '200', 10);
// ---- Zipf distribution for High-Repeat Workload ----
function zipfProb(rank, s, N) {
    let H = 0;
    for (let i = 1; i <= N; i++)
        H += 1 / Math.pow(i, s);
    return (1 / Math.pow(rank, s)) / H;
}
const POOL_SIZE = 500;
const ZIPF_S = 1.1;
const cdf = [];
let acc = 0;
for (let i = 1; i <= POOL_SIZE; i++) {
    acc += zipfProb(i, ZIPF_S, POOL_SIZE);
    cdf.push(acc);
}
const TOPICS = [
    'machine learning', 'neural networks', 'gradient descent',
    'transformer architecture', 'attention mechanisms', 'backpropagation',
    'regularization techniques', 'overfitting prevention', 'bias-variance tradeoff',
    'feature engineering',
];
const PROMPTS = [];
for (let i = 0; i < POOL_SIZE; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const variant = Math.floor(i / TOPICS.length) + 1;
    PROMPTS.push(`Explain ${topic} in simple terms. Variant ${variant}.`);
}
function pickZipfPrompt() {
    const r = Math.random();
    const idx = cdf.findIndex((c) => c >= r);
    return PROMPTS[idx >= 0 ? idx : POOL_SIZE - 1];
}
// 50 prompts for realistic pool
const REALISTIC_POOL = PROMPTS.slice(0, 50);
function pickRealisticPrompt() {
    // 40% repeat from pool, 60% unique
    if (Math.random() < 0.4) {
        const idx = Math.floor(Math.random() * REALISTIC_POOL.length);
        return REALISTIC_POOL[idx];
    }
    return `Unique question ${(0, crypto_1.randomUUID)()}: what are the implications of deep learning?`;
}
function pct(sorted, p) {
    if (sorted.length === 0)
        return 0;
    return sorted[Math.floor((sorted.length - 1) * p)] ?? 0;
}
async function runBenchmark(cfg) {
    console.log(`\n======================================================`);
    console.log(`▶ Starting: ${cfg.name}`);
    console.log(`  Definition: ${cfg.definition}`);
    console.log(`======================================================`);
    const warmupStats = { total: 0, cacheHits: 0, errors: 0, failovers: 0, overheads: [] };
    const benchStats = { total: 0, cacheHits: 0, errors: 0, failovers: 0, overheads: [] };
    let currentStats = warmupStats;
    const executeAutocannon = (duration, label) => {
        return new Promise((resolve, reject) => {
            const headers = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${API_KEY}`,
                ...(cfg.extraHeaders ?? {}),
            };
            const instance = (0, autocannon_1.default)({
                url: `${GATEWAY_URL}/v1/chat/completions`,
                method: 'POST',
                headers,
                connections: CONNECTIONS,
                duration,
                overallRate: RATE,
                setupClient(client) {
                    client.setBody(cfg.makeBody());
                    client.on('headers', (res) => {
                        const s = currentStats;
                        s.total++;
                        if (typeof res.statusCode === 'number' && res.statusCode >= 400)
                            s.errors++;
                        const raw = res.headers || [];
                        for (let i = 0; i < raw.length; i += 2) {
                            const name = raw[i]?.toLowerCase();
                            const val = raw[i + 1] ?? '';
                            if (name === 'x-cache' && val === 'HIT') {
                                s.cacheHits++;
                            }
                            if (name === 'x-gateway-overhead-ms') {
                                const oh = parseInt(val, 10);
                                if (!isNaN(oh))
                                    s.overheads.push(oh);
                            }
                            if (name === 'x-failovers') {
                                const fo = parseInt(val, 10);
                                if (!isNaN(fo) && fo > 0)
                                    s.failovers += fo;
                            }
                        }
                    });
                    client.on('response', () => {
                        client.setBody(cfg.makeBody());
                    });
                },
            }, (err, res) => {
                if (err)
                    reject(err);
                else
                    resolve(res);
            });
            autocannon_1.default.track(instance, { renderProgressBar: true });
            console.log(`▶ [${label}] ${duration}s @ ${RATE} req/s with ${CONNECTIONS} conns...`);
        });
    };
    // Warmup
    currentStats = warmupStats;
    await executeAutocannon(WARMUP_DURATION, `${cfg.name} Warmup`);
    // Bench
    currentStats = benchStats;
    const result = await executeAutocannon(BENCH_DURATION, `${cfg.name} Measured Run`);
    benchStats.overheads.sort((a, b) => a - b);
    const reqPerMin = Math.round((result.requests.total / BENCH_DURATION) * 60);
    const cacheHitRatio = benchStats.total > 0
        ? ((benchStats.cacheHits / benchStats.total) * 100).toFixed(1)
        : '0.0';
    const errorRate = benchStats.total > 0
        ? ((benchStats.errors / benchStats.total) * 100).toFixed(2)
        : '0.00';
    const overheadP50 = pct(benchStats.overheads, 0.5);
    const overheadP95 = pct(benchStats.overheads, 0.95);
    const overheadP99 = pct(benchStats.overheads, 0.99);
    return {
        name: cfg.name,
        definition: cfg.definition,
        totalRequests: result.requests.total,
        reqPerMin,
        cacheHitRatio,
        errorRate,
        overheadP50,
        overheadP95,
        overheadP99,
        latencyP50: result.latency.p50,
        latencyP95: result.latency.p99,
        failoverCount: benchStats.failovers,
    };
}
async function main() {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   AI API Gateway — Multi-Workload Benchmark Suite    ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`Target Gateway : ${GATEWAY_URL}`);
    console.log(`Duration/run   : Warmup ${WARMUP_DURATION}s, Bench ${BENCH_DURATION}s @ ${RATE} req/s (${CONNECTIONS} conns)`);
    const workloads = [
        {
            name: 'High-Repeat Workload',
            definition: '500 prompts with Zipf distribution (s=1.1) simulating hot-key cache heavy traffic (~98% repeats)',
            makeBody: () => JSON.stringify({
                model: 'mock-model',
                messages: [{ role: 'user', content: pickZipfPrompt() }],
                temperature: 0,
            }),
        },
        {
            name: 'Realistic Workload',
            definition: '40% repeated prompts from a 50-item pool, 60% unique generated prompts',
            makeBody: () => JSON.stringify({
                model: 'mock-model',
                messages: [{ role: 'user', content: pickRealisticPrompt() }],
                temperature: 0,
            }),
        },
        {
            name: 'Cache-Miss Path',
            definition: 'Same load with Cache-Control: no-cache header forcing every request to upstream providers',
            makeBody: () => JSON.stringify({
                model: 'mock-model',
                messages: [{ role: 'user', content: pickZipfPrompt() }],
                temperature: 0,
            }),
            extraHeaders: {
                'Cache-Control': 'no-cache',
            },
        },
    ];
    const selectedWorkload = process.env['WORKLOAD'];
    const toRun = selectedWorkload
        ? workloads.filter((w) => w.name.toLowerCase().includes(selectedWorkload.toLowerCase()))
        : workloads;
    const results = [];
    for (const w of toRun) {
        const res = await runBenchmark(w);
        results.push(res);
    }
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║               ALL BENCHMARK RESULTS                  ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');
    console.table(results.map((r) => ({
        Workload: r.name,
        'Req/Min': r.reqPerMin,
        'Cache Hit %': `${r.cacheHitRatio}%`,
        'Overhead p50': `${r.overheadP50}ms`,
        'Overhead p95': `${r.overheadP95}ms`,
        'Overhead p99': `${r.overheadP99}ms`,
        'Failovers': r.failoverCount,
        'Error Rate': `${r.errorRate}%`,
    })));
    const md = `# Benchmark Results

> Generated: ${new Date().toISOString()}  
> System: Node.js 20 on Linux (WSL2) / Redis 8 / PostgreSQL 18  
> Rate: ${RATE} req/s, ${CONNECTIONS} concurrent connections

## Workload Definitions

1. **High-Repeat Workload**: 500 prompts sampled using Zipf distribution ($s=1.1$). Warmup populates the cache, testing throughput when popular prompts recur frequently.
2. **Realistic Workload**: 40% of queries select from a pool of 50 repeated prompts, while 60% are completely unique requests with random UUIDs.
3. **Cache-Miss Path**: Each request includes \`Cache-Control: no-cache\`, forcing cache bypass and full gateway routing, circuit breaker checks, and provider roundtrips.

## Summary Results Table

| Workload | Throughput (Req/Min) | Cache Hit % | Gateway Overhead p50 | Gateway Overhead p95 | Gateway Overhead p99 | Total Latency p50 | Total Latency p95 | Failover Count | Error Rate % |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
${results
        .map((r) => `| **${r.name}** | **${r.reqPerMin}** | **${r.cacheHitRatio}%** | ${r.overheadP50} ms | **${r.overheadP95} ms** | ${r.overheadP99} ms | ${r.latencyP50} ms | ${r.latencyP95} ms | ${r.failoverCount} | ${r.errorRate}% |`)
        .join('\n')}

## Acceptance Targets Evaluation

| Target Requirement | Expected | High-Repeat Workload | Realistic Workload | Cache-Miss Path | Status |
|---|---|:---:|:---:|:---:|:---:|
| **Cache Hit Ratio** | $\\ge 30\\%$ | ${results[0]?.cacheHitRatio}% | ${results[1]?.cacheHitRatio}% | ${results[2]?.cacheHitRatio}% | ${parseFloat(results[0]?.cacheHitRatio ?? '0') >= 30 ? '✅ PASS' : '❌ FAIL'} |
| **Sustained Throughput** | $\\ge 5,000$ req/min | ${results[0]?.reqPerMin} | ${results[1]?.reqPerMin} | ${results[2]?.reqPerMin} | ${results.every((r) => r.reqPerMin >= 5000) ? '✅ PASS' : '❌ FAIL'} |
| **Gateway Routing Overhead p95** | $< 50$ ms | ${results[0]?.overheadP95} ms | ${results[1]?.overheadP95} ms | ${results[2]?.overheadP95} ms | ${results.every((r) => r.overheadP95 < 50) ? '✅ PASS' : '❌ FAIL'} |

---
*Note: Gateway overhead = total roundtrip time − provider execution latency, measured directly from \`X-Gateway-Overhead-Ms\` headers. All numbers measured by automated benchmark execution.*
`;
    fs.writeFileSync(path.join(__dirname, 'results.md'), md, 'utf-8');
    console.log('✅ Results successfully written to bench/results.md\n');
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
