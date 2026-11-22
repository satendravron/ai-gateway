import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { MetricsSnapshot, ProviderStatus, LogEntry } from './types';

const WS_URL = (import.meta.env['VITE_WS_URL'] as string | undefined) ?? 'ws://localhost:4001/ws';
const API_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:4001';
const RING_SIZE = 600;
const RENDER_INTERVAL_MS = 1000;

function ringPush<T>(arr: T[], item: T, size: number): T[] {
  const next = [...arr, item];
  return next.length > size ? next.slice(next.length - size) : next;
}

type WsMsg = { type: 'hello' | 'metrics' | 'providers'; data: unknown };

export default function App() {
  const [displayMetrics, setDisplayMetrics] = useState<MetricsSnapshot[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);

  const metricsRef = useRef<MetricsSnapshot[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(1000);
  const mountedRef = useRef(true);

  // Persistence ref for KPIs so they don't drop to 0 during brief pauses
  const lastActiveKpisRef = useRef<{
    reqPerMin: number;
    hitPct: string;
    errPct: string;
    p95: number;
    tokPerMin: number;
  }>({
    reqPerMin: 0,
    hitPct: '0.0',
    errPct: '0.0',
    p95: 0,
    tokPerMin: 0,
  });

  // Throttle chart renders: flush ref → state at most 1/s
  useEffect(() => {
    const id = setInterval(() => {
      if (metricsRef.current.length > 0) {
        setDisplayMetrics([...metricsRef.current]);
      }
    }, RENDER_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const handleMsg = useCallback((raw: unknown) => {
    const msg = raw as WsMsg;
    if (msg.type === 'hello') {
      metricsRef.current = (msg.data as MetricsSnapshot[]).slice(-RING_SIZE);
    } else if (msg.type === 'metrics') {
      metricsRef.current = ringPush(metricsRef.current, msg.data as MetricsSnapshot, RING_SIZE);
    } else if (msg.type === 'providers') {
      setProviders(msg.data as ProviderStatus[]);
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = 1000;
    };
    ws.onmessage = (e) => {
      try { handleMsg(JSON.parse(e.data as string)); } catch { /* noop */ }
    };
    ws.onclose = () => {
      setConnected(false);
      if (mountedRef.current) {
        const d = reconnectDelay.current;
        reconnectDelay.current = Math.min(d * 2, 15_000);
        setTimeout(connect, d);
      }
    };
    ws.onerror = () => ws.close();
  }, [handleMsg]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
    };
  }, [connect]);

  // Poll logs every 5 s
  useEffect(() => {
    const fetchLogs = () => {
      fetch(`${API_URL}/api/logs?limit=20`)
        .then((r) => r.json())
        .then((d) => setLogs(d as LogEntry[]))
        .catch(() => { /* noop */ });
    };
    fetchLogs();
    const id = setInterval(fetchLogs, 5_000);
    return () => clearInterval(id);
  }, []);

  // -------------------------------------------------------------
  // 1. KPI Calculations using a Rolling 60-Second Window
  // -------------------------------------------------------------
  const now = Date.now();
  const latestTs = displayMetrics.length > 0
    ? Math.max(...displayMetrics.map((m) => new Date(m.ts).getTime()).filter((t) => !isNaN(t)))
    : now;
  const refTime = Math.max(now, latestTs);
  const windowCutoff = refTime - 60_000;

  // Snapshots strictly within the last 60 seconds
  const windowMetrics = displayMetrics.filter((m) => {
    const t = new Date(m.ts).getTime();
    return !isNaN(t) && t >= windowCutoff;
  });

  const windowReqs = windowMetrics.reduce((s, m) => s + m.requests, 0);
  const windowHits = windowMetrics.reduce((s, m) => s + m.cacheHits, 0);
  const windowErrs = windowMetrics.reduce((s, m) => s + m.errors, 0);
  const windowTokens = windowMetrics.reduce((s, m) => s + m.promptTokens + m.completionTokens, 0);

  const activeSnaps = windowMetrics.filter((m) => m.requests > 0);

  // Time elapsed in this window (seconds, capped at 60)
  const firstWindowTs = windowMetrics.length > 0
    ? Math.min(...windowMetrics.map((m) => new Date(m.ts).getTime()).filter((t) => !isNaN(t)))
    : refTime;
  const elapsedSeconds = Math.max(1, Math.min(60, (refTime - firstWindowTs) / 1000));

  // Current window rate values
  const rollingReqPerMin = Math.round((windowReqs / elapsedSeconds) * 60);
  const rollingTokPerMin = Math.round((windowTokens / elapsedSeconds) * 60);
  const rollingHitPct = windowReqs > 0 ? ((windowHits / windowReqs) * 100).toFixed(1) : null;
  const rollingErrPct = windowReqs > 0 ? ((windowErrs / windowReqs) * 100).toFixed(1) : null;
  const rollingP95 = activeSnaps.length > 0 && windowReqs > 0
    ? Math.round(activeSnaps.reduce((s, m) => s + m.p95 * m.requests, 0) / windowReqs)
    : null;

  // Update persistent last-active KPIs when requests exist
  if (windowReqs > 0) {
    lastActiveKpisRef.current = {
      reqPerMin: rollingReqPerMin,
      hitPct: rollingHitPct ?? lastActiveKpisRef.current.hitPct,
      errPct: rollingErrPct ?? lastActiveKpisRef.current.errPct,
      p95: rollingP95 ?? lastActiveKpisRef.current.p95,
      tokPerMin: rollingTokPerMin,
    };
  }

  // Display values: preserve rolling metrics or last-active values during brief pauses
  const displayReqPerMin = windowReqs > 0 ? rollingReqPerMin : (lastActiveKpisRef.current.reqPerMin || 0);
  const displayHitPct = rollingHitPct ?? lastActiveKpisRef.current.hitPct;
  const displayErrPct = rollingErrPct ?? lastActiveKpisRef.current.errPct;
  const displayP95 = (rollingP95 !== null && rollingP95 > 0)
    ? rollingP95
    : (lastActiveKpisRef.current.p95 > 0 ? lastActiveKpisRef.current.p95 : (displayMetrics[displayMetrics.length - 1]?.p95 || 0));
  const displayTokPerMin = windowReqs > 0 ? rollingTokPerMin : (lastActiveKpisRef.current.tokPerMin || 0);

  const kpis = [
    { label: 'Req/min', value: displayReqPerMin.toLocaleString() },
    { label: 'Cache Hit %', value: `${displayHitPct}%` },
    { label: 'Error Rate %', value: `${displayErrPct}%` },
    { label: 'p95 Overhead', value: displayP95 > 0 ? `${displayP95}ms` : '—' },
    { label: 'Tokens/min', value: displayTokPerMin.toLocaleString() },
  ];

  // -------------------------------------------------------------
  // 2. Aggregate Snapshots into Per-Second Buckets for Charts
  // -------------------------------------------------------------
  const secMap = new Map<number, {
    sec: number;
    requests: number;
    errors: number;
    prompt: number;
    completion: number;
    p95WeightedSum: number;
  }>();

  for (const m of displayMetrics) {
    const time = new Date(m.ts).getTime();
    if (isNaN(time)) continue;
    const sec = Math.floor(time / 1000) * 1000;
    let b = secMap.get(sec);
    if (!b) {
      b = { sec, requests: 0, errors: 0, prompt: 0, completion: 0, p95WeightedSum: 0 };
      secMap.set(sec, b);
    }
    b.requests += m.requests;
    b.errors += m.errors;
    b.prompt += m.promptTokens;
    b.completion += m.completionTokens;
    if (m.requests > 0 && m.p95 > 0) {
      b.p95WeightedSum += m.p95 * m.requests;
    }
  }

  const sortedSecs = Array.from(secMap.keys()).sort((a, b) => a - b);
  const chartData: Array<{
    t: string;
    requests: number;
    errors: number;
    tokens: number;
    prompt: number;
    completion: number;
    p95: number;
  }> = [];

  if (sortedSecs.length > 0) {
    const minSec = sortedSecs[0]!;
    const maxSec = sortedSecs[sortedSecs.length - 1]!;
    let lastSecP95 = 0;

    for (let s = minSec; s <= maxSec; s += 1000) {
      const b = secMap.get(s);
      if (b) {
        const p95 = b.requests > 0 ? Math.round(b.p95WeightedSum / b.requests) : lastSecP95;
        if (p95 > 0) lastSecP95 = p95;
        chartData.push({
          t: new Date(s).toLocaleTimeString(),
          requests: b.requests,
          errors: b.errors,
          tokens: b.prompt + b.completion,
          prompt: b.prompt,
          completion: b.completion,
          p95,
        });
      } else {
        chartData.push({
          t: new Date(s).toLocaleTimeString(),
          requests: 0,
          errors: 0,
          tokens: 0,
          prompt: 0,
          completion: 0,
          p95: lastSecP95,
        });
      }
    }
  }

  // Display the last 60 seconds on the charts
  const recentChartData = chartData.slice(-60);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">🚀 AI Gateway Dashboard</h1>
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold ${
              connected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
            }`}
          >
            {connected ? '● Live' : '○ Reconnecting…'}
          </span>
        </div>

        {/* KPI Cards (Rolling 60-Second Window) */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
              <p className="text-xs text-gray-400 uppercase tracking-wide">{kpi.label}</p>
              <p className="text-2xl font-bold text-white mt-1">{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Charts: per-SECOND values with '/ sec' in titles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Requests &amp; Errors / sec</h2>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={recentChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', color: '#F9FAFB' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="requests" stroke="#6366F1" fill="#6366F122" name="Requests / sec" />
                <Area type="monotone" dataKey="errors" stroke="#EF4444" fill="#EF444422" name="Errors / sec" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Tokens / sec</h2>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={recentChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', color: '#F9FAFB' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="prompt" stroke="#10B981" dot={false} name="Prompt Tokens / sec" />
                <Line type="monotone" dataKey="completion" stroke="#F59E0B" dot={false} name="Completion Tokens / sec" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Provider Health Table */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Provider Health</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-800">
                  <th className="text-left pb-2 pr-4">Provider</th>
                  <th className="text-left pb-2 pr-4">State</th>
                  <th className="text-right pb-2 pr-4">EWMA ms</th>
                  <th className="text-right pb-2 pr-4">Inflight</th>
                  <th className="text-right pb-2">Error Rate</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.name} className="border-b border-gray-800/50">
                    <td className="py-2 pr-4 font-mono text-gray-200">{p.name}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          p.state === 'CLOSED'
                            ? 'bg-green-900 text-green-300'
                            : p.state === 'HALF_OPEN'
                            ? 'bg-yellow-900 text-yellow-300'
                            : 'bg-red-900 text-red-300'
                        }`}
                      >
                        {p.state}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">{p.ewmaMs.toFixed(0)}</td>
                    <td className="py-2 pr-4 text-right font-mono">{p.inflight}</td>
                    <td className="py-2 text-right font-mono">{(p.errorRate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                {providers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-gray-500 text-sm">
                      Waiting for provider data…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Requests Table */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Recent Requests (polls every 5s)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left pb-2 pr-3">Time</th>
                  <th className="text-left pb-2 pr-3">Provider</th>
                  <th className="text-left pb-2 pr-3">Model</th>
                  <th className="text-center pb-2 pr-3">Cache</th>
                  <th className="text-center pb-2 pr-3">Status</th>
                  <th className="text-right pb-2 pr-3">Total ms</th>
                  <th className="text-right pb-2">GW ms</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-1.5 pr-3 font-mono text-gray-300">
                      {new Date(log.ts).toLocaleTimeString()}
                    </td>
                    <td className="py-1.5 pr-3 text-gray-200">{log.provider}</td>
                    <td className="py-1.5 pr-3 font-mono text-gray-400">{log.model}</td>
                    <td className="py-1.5 pr-3 text-center">
                      {log.cache_hit ? (
                        <span className="text-green-400 font-semibold">HIT</span>
                      ) : (
                        <span className="text-gray-500">MISS</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-center">
                      <span className={log.status_code < 400 ? 'text-green-400' : 'text-red-400'}>
                        {log.status_code}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono">{log.total_latency_ms}</td>
                    <td className="py-1.5 text-right font-mono">{log.gateway_overhead_ms}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-gray-500">
                      No requests yet…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
