'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { trpc } from '@/lib/trpc';

interface OperationRow {
  operationName: string;
  operationType: string;
  callCount: number;
  errorCount: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

interface LatencyRow {
  fieldPath: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  samples: number;
}

interface ErrorRatePoint {
  hour: string;
  errorRate: number;
  totalCalls: number;
}

export default function OperationsPage() {
  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [latencyData, setLatencyData] = useState<LatencyRow[]>([]);
  const [errorSeries, setErrorSeries] = useState<ErrorRatePoint[]>([]);
  const [selectedOperation, setSelectedOperation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingBreakdown, setLoadingBreakdown] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const from = useMemo(() => new Date(Date.now() - 24 * 60 * 60 * 1000), []);
  const to = useMemo(() => new Date(), []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [topOperations, errorRate] = await Promise.all([
          trpc.operations.topOperations.query({ from, to, limit: 20 }),
          trpc.operations.errorRate.query({ from, to }),
        ]);

        setOperations(topOperations || []);
        setErrorSeries(
          (errorRate || []).map((point) => ({
            hour: new Date(point.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            errorRate: point.errorRate,
            totalCalls: point.totalCalls,
          }))
        );
        setSelectedOperation(topOperations?.[0]?.operationName ?? null);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [from, to]);

  useEffect(() => {
    const fetchBreakdown = async () => {
      if (!selectedOperation) {
        setLatencyData([]);
        setLoadingBreakdown(false);
        return;
      }

      setLoadingBreakdown(true);
      try {
        const result = await trpc.operations.latencyBreakdown.query({
          operationName: selectedOperation,
          from,
          to,
          limit: 25,
        });
        setLatencyData(result || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoadingBreakdown(false);
      }
    };

    fetchBreakdown();
  }, [from, selectedOperation, to]);

  const selectedOperationMetrics = operations.find((row) => row.operationName === selectedOperation) ?? null;
  const chartData = operations.slice(0, 10).map((row) => ({
    name: row.operationName.length > 24 ? `${row.operationName.slice(0, 21)}...` : row.operationName,
    p95: Math.round(row.p95Ms),
    errorRate: Number(row.errorRate.toFixed(2)),
  }));

  const resolverChartData = latencyData.slice(0, 10).map((row) => ({
    name: row.fieldPath.length > 24 ? `...${row.fieldPath.slice(-21)}` : row.fieldPath,
    p95: Math.round(row.p95Ms),
    p99: Math.round(row.p99Ms),
  }));

  const peakP99 = latencyData.length ? Math.max(...latencyData.map((d) => d.p99Ms)) : 0;
  const avgP99 = latencyData.length
    ? Math.round(latencyData.reduce((sum, d) => sum + d.p99Ms, 0) / latencyData.length)
    : 0;

  return (
    <div className="dash-page">
      <header className="dash-topbar">
        <div className="dash-topbar-inner">
          <div className="dash-brand">
            <i className="ti ti-activity-heartbeat" aria-hidden="true" />
            <span className="dash-brand-title">GraphQL Analytics</span>
            <span className="dash-brand-sep">&middot;</span>
            <span className="dash-brand-subtitle">Operations intelligence</span>
          </div>

          <nav className="dash-nav" aria-label="Primary">
            <Link href="/" className="dash-nav-link">Overview</Link>
            <Link href="/fields" className="dash-nav-link">Fields</Link>
            <Link href="/operations" className="dash-nav-link dash-nav-link-active">Operations</Link>
            <Link href="/schema" className="dash-nav-link">Schema</Link>
            <Link href="/security" className="dash-nav-link">Security</Link>
          </nav>

          <div className="dash-topbar-right">
            <span className="live-dot" aria-hidden="true" />
            <span className="dash-live-label">Live</span>
            <span className="dash-updated">Selected: {selectedOperation ?? 'none'}</span>
          </div>
        </div>
      </header>

      <main className="dash-main">
        <section className="dash-grid-3">
          <article className="dash-card metric-card">
            <p className="metric-label">Tracked Operations</p>
            <p className="metric-value mono">{operations.length}</p>
            <span className="metric-pill metric-pill-success">Last 24h</span>
          </article>
          <article className="dash-card metric-card">
            <p className="metric-label">Selected p95</p>
            <p className="metric-value mono">{selectedOperationMetrics ? `${selectedOperationMetrics.p95Ms.toFixed(0)}ms` : '—'}</p>
            <span className="metric-pill" style={{ color: 'var(--warning)', background: 'rgba(245,158,11,0.12)' }}>Operation latency</span>
          </article>
          <article className="dash-card metric-card">
            <p className="metric-label">Selected Error Rate</p>
            <p className="metric-value mono">{selectedOperationMetrics ? `${selectedOperationMetrics.errorRate.toFixed(2)}%` : '—'}</p>
            <span className="metric-pill metric-pill-success">Operation health</span>
          </article>
        </section>

        {loading && <div className="dash-card dash-loading"><p>Loading operation analytics...</p></div>}
        {error && <div className="dash-card dash-error">{error}</div>}

        {!loading && (
          <>
            <section className="dash-grid-2">
              <article className="dash-card table-card">
                <div className="table-head">
                  <p><i className="ti ti-activity" style={{ color: 'var(--accent)' }} /> Top Operations</p>
                  <span className="spark-pill">24h volume</span>
                </div>
                <div className="table-body">
                  {operations.map((row, idx) => (
                    <button
                      type="button"
                      key={`${row.operationName}.${row.operationType}.${idx}`}
                      className="table-row"
                      onClick={() => setSelectedOperation(row.operationName)}
                      style={{ background: row.operationName === selectedOperation ? 'rgba(99,102,241,0.08)' : 'transparent', cursor: 'pointer', border: 'none', width: '100%' }}
                    >
                      <div className="row-name mono" style={{ textAlign: 'left' }}>
                        <span className="prefix accent">{row.operationType} </span>
                        <span>{row.operationName}</span>
                      </div>
                      <div className="row-metric">
                        <span className="mono">{row.callCount}</span>
                        <span className="mono" style={{ color: row.errorRate > 5 ? 'var(--danger)' : 'var(--text-secondary)' }}>{row.errorRate.toFixed(1)}%</span>
                        <span className="mono">{row.p95Ms.toFixed(0)}ms</span>
                      </div>
                    </button>
                  ))}
                </div>
              </article>

              <article className="dash-card table-card">
                <div className="table-head">
                  <p><i className="ti ti-chart-bar" style={{ color: 'var(--accent)' }} /> Operation p95</p>
                  <span className="spark-pill">Top 10</span>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={190} tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#1E1E2E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#F1F5F9' }}
                      labelStyle={{ color: '#F1F5F9' }}
                    />
                    <Bar dataKey="p95" fill="#6366F1" radius={[2, 2, 2, 2]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>
            </section>

            <section className="dash-card table-card">
              <div className="table-head">
                <p><i className="ti ti-alert-circle" style={{ color: 'var(--warning)' }} /> Error Trend</p>
                <span className="spark-pill">Hourly</span>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={errorSeries} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#1E1E2E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#F1F5F9' }}
                    labelStyle={{ color: '#F1F5F9' }}
                  />
                  <Line type="monotone" dataKey="errorRate" stroke="#F59E0B" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            <section className="dash-grid-3">
              <article className="dash-card metric-card">
                <p className="metric-label">Resolver Paths</p>
                <p className="metric-value mono">{latencyData.length}</p>
                <span className="metric-pill metric-pill-success">For selected op</span>
              </article>
              <article className="dash-card metric-card">
                <p className="metric-label">Peak Resolver p99</p>
                <p className="metric-value mono">{peakP99.toFixed(0)}ms</p>
                <span className="metric-pill" style={{ color: 'var(--warning)', background: 'rgba(245,158,11,0.12)' }}>Hot resolver</span>
              </article>
              <article className="dash-card metric-card">
                <p className="metric-label">Average Resolver p99</p>
                <p className="metric-value mono">{avgP99.toFixed(0)}ms</p>
                <span className="metric-pill metric-pill-success">Selected operation</span>
              </article>
            </section>

            {loadingBreakdown ? (
              <div className="dash-card dash-loading"><p>Loading resolver breakdown...</p></div>
            ) : (
              <section className="dash-grid-2">
                <article className="dash-card table-card">
                  <div className="table-head">
                    <p><i className="ti ti-clock" style={{ color: 'var(--warning)' }} /> Resolver Timing Table</p>
                    <span className="p99-badge">{selectedOperation ?? 'all'}</span>
                  </div>
                  <div className="table-body">
                    {latencyData.map((row, idx) => {
                      const dotIndex = row.fieldPath.indexOf('.');
                      const prefix = dotIndex > -1 ? row.fieldPath.slice(0, dotIndex + 1) : '';
                      const leaf = dotIndex > -1 ? row.fieldPath.slice(dotIndex + 1) : row.fieldPath;
                      const latencyClass = row.p99Ms < 20 ? 'latency-ok' : row.p99Ms <= 50 ? 'latency-warn' : 'latency-danger';
                      return (
                        <div className="table-row" key={`${row.fieldPath}.${idx}`}>
                          <div className="row-name mono">
                            <span className="prefix warn">{prefix}</span>
                            <span>{leaf}</span>
                          </div>
                          <div className="row-metric">
                            <span className="mono" style={{ color: 'var(--text-secondary)' }}>{row.samples}</span>
                            <span className="mono" style={{ color: 'var(--text-secondary)' }}>{row.p50Ms.toFixed(1)}ms</span>
                            <span className="mono" style={{ color: 'var(--text-secondary)' }}>{row.p95Ms.toFixed(1)}ms</span>
                            <span className={`mono ${latencyClass}`}>{row.p99Ms.toFixed(1)}ms</span>
                          </div>
                        </div>
                      );
                    })}
                    {!latencyData.length && <div className="table-row"><div className="row-name"><span>No resolver timing data yet for this operation.</span></div></div>}
                  </div>
                </article>

                <article className="dash-card table-card">
                  <div className="table-head">
                    <p><i className="ti ti-chart-histogram" style={{ color: 'var(--accent)' }} /> Resolver p95/p99</p>
                    <span className="spark-pill">Top 10</span>
                  </div>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={resolverChartData} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={200} tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#1E1E2E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#F1F5F9' }} labelStyle={{ color: '#F1F5F9' }} />
                      <Bar dataKey="p95" fill="rgba(99,102,241,0.55)" radius={[2, 2, 2, 2]} />
                      <Bar dataKey="p99" fill="#6366F1" radius={[2, 2, 2, 2]} />
                    </BarChart>
                  </ResponsiveContainer>
                </article>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

