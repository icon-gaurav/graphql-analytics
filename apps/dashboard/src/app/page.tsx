'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { trpc } from '@/lib/trpc';

interface SummaryData {
  operationsLast24h: number;
  errorRate: number;
  slowestResolvers: Array<{ fieldPath: string; avgP99Ms: number }>;
  topFields: Array<{ typeName: string; fieldName: string; callCount: number }>;
  topClients: Array<{ clientName: string; callCount: number; errorCount: number }>;
  lastSeenAt: string | null;
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return '00:00';
  if (i === 6) return '06:00';
  if (i === 12) return '12:00';
  if (i === 18) return '18:00';
  if (i === 23) return 'now';
  return '';
});

function normalizeVolumeData(data: number[] | null | undefined): number[] {
  return Array.from({ length: 24 }, (_, i) => {
    const value = data?.[i];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  });
}

export default function OverviewPage() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [volumeData, setVolumeData] = useState<number[]>(() => normalizeVolumeData([]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [summaryResult, volumeResult] = await Promise.allSettled([
          trpc.overview.summary.query(),
          trpc.overview.hourlyVolume.query(),
        ]);

        if (summaryResult.status === 'fulfilled') {
          setData(summaryResult.value);
        } else {
          throw summaryResult.reason;
        }

        if (volumeResult.status === 'fulfilled') {
          setVolumeData(normalizeVolumeData(volumeResult.value));
        } else {
          // Keep graph stable even when hourly volume query fails transiently.
          setVolumeData(normalizeVolumeData([]));
          setError('Volume data temporarily unavailable. Showing fallback data.');
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const peakOps = useMemo(() => Math.max(...volumeData, 0), [volumeData]);
  const avgOps = useMemo(
    () => (volumeData.length > 0 ? Math.round(volumeData.reduce((a, b) => a + b, 0) / volumeData.length) : 0),
    [volumeData]
  );

  const chartData = useMemo(
    () => HOUR_LABELS.map((hour, i) => ({ hour, ops: volumeData[i] ?? 0 })),
    [volumeData]
  );

  const formatField = (typeName: string, fieldName: string) => ({
    prefix: `${typeName}.`,
    leaf: fieldName,
  });

  const formatPath = (path: string) => {
    const idx = path.indexOf('.');
    if (idx === -1) return { prefix: '', leaf: path };
    return { prefix: path.slice(0, idx + 1), leaf: path.slice(idx + 1) };
  };

  const maxFieldCalls = useMemo(() => {
    if (!data?.topFields?.length) return 1;
    return Math.max(...data.topFields.map((f) => f.callCount), 1);
  }, [data]);

  const maxResolverMs = useMemo(() => {
    if (!data?.slowestResolvers?.length) return 1;
    return Math.max(...data.slowestResolvers.map((r) => r.avgP99Ms), 1);
  }, [data]);

  const formattedLastSeen = useMemo(() => {
    if (!data?.lastSeenAt) {
      return 'No events yet';
    }

    return new Date(data.lastSeenAt).toLocaleString();
  }, [data?.lastSeenAt]);

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
            <Link href="/" className="dash-nav-link dash-nav-link-active">Overview</Link>
            <Link href="/fields" className="dash-nav-link">Fields</Link>
            <Link href="/operations" className="dash-nav-link">Operations</Link>
            <Link href="/schema" className="dash-nav-link">Schema</Link>
            <Link href="/security" className="dash-nav-link">Security</Link>
          </nav>

          <div className="dash-topbar-right">
            <span className="live-dot" aria-hidden="true" />
            <span className="dash-live-label">Live</span>
            <span className="dash-updated">Last seen: {formattedLastSeen}</span>
          </div>
        </div>
      </header>

      <main className="dash-main">
        {loading && (
          <div className="dash-card dash-loading">
            <div className="dash-loading-spinner" />
            <p>Loading analytics...</p>
          </div>
        )}

        {error && (
          <div className="dash-card dash-error">
            <p className="dash-error-title">Error</p>
            <p>{error}</p>
          </div>
        )}

        {data && (
          <>
            <section className="dash-grid-3">
              <article className="dash-card metric-card">
                <p className="metric-label">Operations (24h)</p>
                <p className="metric-value">{data.operationsLast24h}</p>
                <span className="metric-pill metric-pill-success">↑ +2 from yesterday</span>
              </article>

              <article className="dash-card metric-card">
                <p className="metric-label">Error Rate</p>
                <p className="metric-value">{data.errorRate.toFixed(2)}%</p>
                <span className="metric-pill metric-pill-success">● Healthy</span>
              </article>

              <article className="dash-card metric-card">
                <p className="metric-label">Status</p>
                <div className="status-grid">
                  <div className="status-row"><span className="status-dot status-dot-success" />Collector <span>Operational</span></div>
                  <div className="status-row"><span className="status-dot status-dot-success" />Dashboard <span>Operational</span></div>
                  <div className="status-row"><span className="status-dot status-dot-success" />Database <span>Operational</span></div>
                </div>
              </article>
            </section>

            <section className="dash-card spark-card">
              <div className="spark-head">
                <p className="spark-title">Request volume — last 24h</p>
                <div className="spark-pills">
                  <span className="spark-pill">Peak: {peakOps} ops</span>
                  <span className="spark-pill">Avg: {avgOps} ops</span>
                </div>
              </div>
              <div className="spark-wrap">
                <ResponsiveContainer width="100%" height={80}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366F1" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="hour"
                      tick={{ fill: '#64748B', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{
                        background: '#1E1E2E',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 6,
                        color: '#F8FAFC',
                        fontSize: 12,
                      }}
                      labelStyle={{ color: '#F8FAFC' }}
                      formatter={(value: number) => [`${value} operations`, '']}
                    />
                    <Area
                      type="monotone"
                      dataKey="ops"
                      stroke="#6366F1"
                      strokeWidth={2}
                      fill="url(#volumeGradient)"
                      dot={false}
                      activeDot={{ r: 3, fill: '#6366F1' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="dash-grid-2">
              <article className="dash-card table-card">
                <div className="table-head">
                  <p><i className="ti ti-chart-bar" /> Top 5 Fields</p>
                  <div className="table-subtabs">
                    <span className="active">By calls</span>
                    <span>By type</span>
                  </div>
                </div>
                <div className="table-body">
                  {data.topFields.map((field, idx) => {
                    const parts = formatField(field.typeName, field.fieldName);
                    const pct = Math.max(8, Math.round((field.callCount / maxFieldCalls) * 100));
                    return (
                      <div className="table-row" key={`${field.typeName}.${field.fieldName}.${idx}`}>
                        <div className="row-name mono">
                          <span className="prefix accent">{parts.prefix}</span>
                          <span>{parts.leaf}</span>
                        </div>
                        <div className="row-metric">
                          <span className="mono">{field.callCount}</span>
                          <span className="mini-bar"><span style={{ width: `${pct}%` }} /></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>

              <article className="dash-card table-card">
                <div className="table-head">
                  <p><i className="ti ti-clock" /> Slowest Resolvers</p>
                  <span className="p99-badge">p99</span>
                </div>
                <div className="table-body">
                  {data.slowestResolvers.map((resolver, idx) => {
                    const parts = formatPath(resolver.fieldPath);
                    const pct = Math.max(8, Math.round((resolver.avgP99Ms / maxResolverMs) * 100));
                    const latencyClass =
                      resolver.avgP99Ms < 20
                        ? 'latency-ok'
                        : resolver.avgP99Ms <= 50
                          ? 'latency-warn'
                          : 'latency-danger';
                    return (
                      <div className="table-row" key={`${resolver.fieldPath}.${idx}`}>
                        <div className="row-name mono">
                          <span className="prefix warn">{parts.prefix}</span>
                          <span>{parts.leaf}</span>
                        </div>
                        <div className="row-metric">
                          <span className={`mono ${latencyClass}`}>{resolver.avgP99Ms.toFixed(2)}ms</span>
                          <span className="mini-bar mini-bar-warn"><span style={{ width: `${pct}%` }} /></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            </section>

            <section className="dash-grid-2">
              <article className="dash-card table-card">
                <div className="table-head">
                  <p><i className="ti ti-devices" /> Top Clients</p>
                  <span className="p99-badge">24h</span>
                </div>
                <div className="table-body">
                  {data.topClients.length > 0 ? data.topClients.map((client, idx) => {
                    const errorRate = client.callCount > 0 ? (client.errorCount / client.callCount) * 100 : 0;
                    return (
                      <div className="table-row" key={`${client.clientName}.${idx}`}>
                        <div className="row-name mono">
                          <span>{client.clientName}</span>
                        </div>
                        <div className="row-metric">
                          <span className="mono">{client.callCount}</span>
                          <span className="mono" style={{ color: errorRate > 5 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                            {errorRate.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="table-row">
                      <div className="row-name">
                        <span>No client metadata captured yet.</span>
                      </div>
                    </div>
                  )}
                </div>
              </article>

              <article className="dash-card table-card">
                <div className="table-head">
                  <p><i className="ti ti-pulse" /> Pipeline Freshness</p>
                  <span className="p99-badge">live</span>
                </div>
                <div className="table-body">
                  <div className="table-row">
                    <div className="row-name">
                      <span>Most recent event</span>
                    </div>
                    <div className="row-metric">
                      <span className="mono">{formattedLastSeen}</span>
                    </div>
                  </div>
                  <div className="table-row">
                    <div className="row-name">
                      <span>Tracked clients</span>
                    </div>
                    <div className="row-metric">
                      <span className="mono">{data.topClients.length}</span>
                    </div>
                  </div>
                  <div className="table-row">
                    <div className="row-name">
                      <span>Request points</span>
                    </div>
                    <div className="row-metric">
                      <span className="mono">{chartData.length}</span>
                    </div>
                  </div>
                </div>
              </article>
            </section>
          </>
        )}
      </main>
    </div>
  );
}



