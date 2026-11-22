# Provider Failover & Circuit Breaker Demonstration

> Generated: 2026-11-21T19:55:41.222Z  
> Test Target: `http://127.0.0.1:4000`  
> Failure Injected: Killed upstream `provider-c` (port 3003) while running concurrent load

## Overview

This demonstration proves that the gateway provides seamless high availability under upstream provider failure:
1. Load is generated across all providers with `Cache-Control: no-cache`.
2. `provider-c` is abruptly killed mid-run (simulating network partition or provider crash).
3. The gateway catches the failure, immediately retries the request against healthy providers (failover), and returns **200 OK** to the client.
4. Consecutive failures trigger `provider-c`'s Circuit Breaker to transition from **CLOSED** to **OPEN** in `/api/stats`.
5. Future requests automatically exclude `provider-c` from the routing pool until its cooldown period expires.

---

## Results Summary

| Metric | Measured Value | Target | Status |
|---|---|---|---|
| **Total Requests** | 1323 | — | — |
| **Successful Responses (200 OK)** | 1323 / 1323 | 100% | ✅ PASS |
| **Success Rate** | **100.00%** | $\ge 99.0\%$ | ✅ PASS |
| **Requests Handled by Failover** | 18 | $> 0$ | ✅ PASS |
| **Provider C Initial State** | `CLOSED` | `CLOSED` | ✅ PASS |
| **Provider C Final State** | `OPEN` | `OPEN` | ✅ PASS |

---

## Traffic Distribution Across Providers

| Provider | Requests Handled | Percentage | Notes |
|---|:---:|:---:|---|
| `provider-a` | **939** | 71.0% | Absorbed failover and normal traffic |
| `provider-b` | **359** | 27.1% | Absorbed failover and normal traffic |
| `provider-c` | **25** | 1.9% | Stopped receiving requests after circuit breaker tripped to OPEN |

---

## Provider Health State Snapshot (`/api/stats`)

```json
[
  {
    "name": "provider-a",
    "state": "CLOSED",
    "ewmaMs": 145,
    "inflight": 0,
    "errorRate": 0
  },
  {
    "name": "provider-b",
    "state": "CLOSED",
    "ewmaMs": 231,
    "inflight": 0,
    "errorRate": 0.05
  },
  {
    "name": "provider-c",
    "state": "OPEN",
    "ewmaMs": 388,
    "inflight": 0,
    "errorRate": 0.25
  }
]
```

---

## Key Takeaways

- **Zero Downtime for Clients:** Success rate remained at **100.00%** despite the sudden termination of an active provider.
- **Circuit Breaker Protection:** The circuit breaker tripped to `OPEN` after threshold failures, preventing subsequent requests from suffering timeout penalties.
- **Failover Verification:** 18 in-flight requests that hit the failing provider were automatically recovered by routing to alternative healthy providers.
