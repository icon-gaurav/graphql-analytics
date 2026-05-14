'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { trpc } from '@/lib/trpc';

interface LatencyRow {
  fieldPath: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  samples: number;
}

export default function OperationsPage() {
  const [data, setData] = useState<LatencyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const to = new Date();
        const result = await trpc.operations.latencyBreakdown.query({ from, to, limit: 50 });
        setData(result || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const chartData = data.slice(0, 10).map((d) => ({
    name: d.fieldPath.length > 25 ? '...' + d.fieldPath.slice(-22) : d.fieldPath,
    p50: Math.round(d.p50Ms),
    p95: Math.round(d.p95Ms),
    p99: Math.round(d.p99Ms),
  }));

  const peakP99 = data.length ? Math.max(...data.map((d) => d.p99Ms)) : 0;
  const avgP99 = data.length
    ? Math.round(data.reduce((sum, d) => sum + d.p99Ms, 0) / data.length)
    : 0;

  return (
    <div className="dash-page">
      <header className="dash-topbar">
        <div className="dash-topbar-inner">
          <div className="dash-brand">
            <i className="ti ti-activity-heartbeat" aria-hidden="true" />
            <span className="dash-brand-title">GraphQL Analytics</span>
            <span className="dash-brand-sep">&middot;</span>
            <span className="dash-brand-subtitle">Real-time monitoring</span>
          </div>

          <nav className="dash-nav" aria-label="Primary">
            <Link href="/" className="dash-nav-link">Overview</Link>
            <Link href="/fields" className="dash-nav-link">Fields</Link>
            <Link href="/operations" className="dash-nav-link dash-nav-link-active">Operations</Link>
          </nav>

          <div className="dash-topbar-right">
            <span className="live-dot" aria-hidden="true" />
            <span className="dash-live-label">Live</span>
            <span className="dash-updated">Last updated: just now</span>
          </div>
        </div>
      </header>

      <main className="dash-main">
        <section className="dash-grid-3">
          <article className="dash-card metric-card">
            <p className="metric-label">Resolver Paths</p>
            <p className="metric-value mono">{data.length}</p>
            <span className="metric-pill metric-pill-success">Last 24h</span>
          </article>
          <article className="dash-card metric-card">
            <p className="metric-label">Peak p99</p>
            <p className="metric-value mono">{peakP99.toFixed(0)}ms</p>
            <span className="metric-pill" style={{ color: 'var(--warning)', background: 'rgba(245,158,11,0.12)' }}>Signal latency</span>
          </article>
          <article className="dash-card metric-card">
            <p className="metric-label">Average p99</p>
            <p className="metric-value mono">{avgP99.toFixed(0)}ms</p>
            <span className="metric-pill metric-pill-success">Stable baseline</span>
          </article>
        </section>

        {loading && <div className="dash-card dash-loading"><p>Loading latency data...</p></div>}
        {error && (
          <div className="dash-card dash-error">
            {error}
          </div>
        )}

        {chartData.length > 0 && (
          <div className="dash-card table-card">
            <div className="table-head">
              <p><i className="ti ti-chart-bar" style={{ color: 'var(--accent)' }} /> Top 10 Slowest Resolvers</p>
              <div className="spark-pills">
                <span className="spark-pill">Peak: {peakP99.toFixed(0)}ms</span>
                <span className="spark-pill">Avg: {avgP99.toFixed(0)}ms</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} layout="vertical">
                <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={210} tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: '#1E1E2E',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8,
                    color: '#F1F5F9',
                  }}
                  labelStyle={{ color: '#F1F5F9' }}
                />
                <Bar dataKey="p50" fill="rgba(99,102,241,0.35)" name="p50" radius={[2, 2, 2, 2]} />
                <Bar dataKey="p95" fill="rgba(99,102,241,0.55)" name="p95" radius={[2, 2, 2, 2]} />
                <Bar dataKey="p99" fill="#6366F1" name="p99" radius={[2, 2, 2, 2]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {data.length > 0 && (
          <article className="dash-card table-card">
            <div className="table-head">
              <p><i className="ti ti-clock" style={{ color: 'var(--warning)' }} /> Resolver Timing Table</p>
              <span className="p99-badge">p99 focus</span>
            </div>
            <div className="table-body">
              {data.map((row, idx) => {
                const dotIndex = row.fieldPath.indexOf('.');
                const prefix = dotIndex > -1 ? row.fieldPath.slice(0, dotIndex + 1) : '';
                const leaf = dotIndex > -1 ? row.fieldPath.slice(dotIndex + 1) : row.fieldPath;
                const latencyClass =
                  row.p99Ms < 20 ? 'latency-ok' : row.p99Ms <= 50 ? 'latency-warn' : 'latency-danger';
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
            </div>
          </article>
        )}

        {!loading && data.length === 0 && (
          <div className="dash-card dash-loading">
            <p>No latency data yet.</p>
          </div>
        )}
      </main>
    </div>
  );
}

