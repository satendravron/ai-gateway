# Benchmark Results

> Generated: 2026-11-22T13:51:20.455Z  
> System: Node.js 20 on Linux (WSL2) / Redis 8 / PostgreSQL 18  
> Rate: 200 req/s, 50 concurrent connections

## Workload Definitions

1. **High-Repeat Workload**: 500 prompts sampled using Zipf distribution ($s=1.1$). Warmup populates the cache, testing throughput when popular prompts recur frequently.
2. **Realistic Workload**: 40% of queries select from a pool of 50 repeated prompts, while 60% are completely unique requests with random UUIDs.
3. **Cache-Miss Path**: Each request includes `Cache-Control: no-cache`, forcing cache bypass and full gateway routing, circuit breaker checks, and provider roundtrips.

## Summary Results Table

| Workload | Throughput (Req/Min) | Cache Hit % | Gateway Overhead p50 | Gateway Overhead p95 | Gateway Overhead p99 | Total Latency p50 | Total Latency p95 | Failover Count | Error Rate % |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **High-Repeat Workload** | **12000** | **99.9%** | 24 ms | **43 ms** | 96 ms | 28 ms | 129 ms | 0 | 0.00% |
| **Realistic Workload** | **11952** | **40.5%** | 7 ms | **34 ms** | 51 ms | 104 ms | 433 ms | 65 | 0.00% |
| **Cache-Miss Path** | **11755** | **0.0%** | 3 ms | **19 ms** | 52 ms | 105 ms | 422 ms | 76 | 0.00% |

## Acceptance Targets Evaluation

| Target Requirement | Expected | High-Repeat Workload | Realistic Workload | Cache-Miss Path | Status |
|---|---|:---:|:---:|:---:|:---:|
| **Cache Hit Ratio** | $\ge 30\%$ | 99.9% | 40.5% | 0.0% | ✅ PASS |
| **Sustained Throughput** | $\ge 5,000$ req/min | 12000 | 11952 | 11755 | ✅ PASS |
| **Gateway Routing Overhead p95** | $< 50$ ms | 43 ms | 34 ms | 19 ms | ✅ PASS |

---
*Note: Gateway overhead = total roundtrip time − provider execution latency, measured directly from `X-Gateway-Overhead-Ms` headers. All numbers measured by automated benchmark execution.*
