'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';
import { trpc } from '@/lib/trpc';

interface OperationDetails {
  operationName: string;
  operationType: string;
  callCount: number;
  errorCount: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  operationQuery: string | null;
  requestHeaders: Record<string, string> | null;
}

interface OperationTrendPoint {
  hour: string;
  callCount: number;
  errorRate: number;
  p95Ms: number;
}

interface ResolverPoint {
  fieldPath: string;
  p95Ms: number;
  p99Ms: number;
  samples: number;
}

interface OperationTrendRaw {
  hour: Date | string;
  callCount: number;
  errorRate: number;
  p95Ms: number;
}

export default function OperationDetailsPage() {
  const params = useParams<{ operationName: string }>();
  const operationName = decodeURIComponent(params.operationName ?? '');

  const [details, setDetails] = useState<OperationDetails | null>(null);
  const [trend, setTrend] = useState<OperationTrendPoint[]>([]);
  const [resolvers, setResolvers] = useState<ResolverPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const from = useMemo(() => new Date(Date.now() - 24 * 60 * 60 * 1000), []);
  const to = useMemo(() => new Date(), []);

  useEffect(() => {
    const load = async () => {
      if (!operationName) return;

      setLoading(true);
      setError(null);
      try {
        const [detailsResult, trendResult, resolverResult] = await Promise.all([
          trpc.operations.operationDetails.query({ operationName, from, to }),
          trpc.operations.operationHourlyTrend.query({ operationName, from, to }),
          trpc.operations.latencyBreakdown.query({ operationName, from, to, limit: 20 }),
        ]);

        setDetails(detailsResult as OperationDetails | null);
        setTrend(
          (trendResult as OperationTrendRaw[]).map((row) => ({
            hour: new Date(row.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            callCount: row.callCount,
            errorRate: row.errorRate,
            p95Ms: row.p95Ms,
          }))
        );
        setResolvers(resolverResult as ResolverPoint[]);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load operation analytics';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [from, operationName, to]);

  const resolverChartData = resolvers.slice(0, 10).map((row) => ({
    name: row.fieldPath.length > 24 ? `...${row.fieldPath.slice(-21)}` : row.fieldPath,
    p95: Math.round(row.p95Ms),
    p99: Math.round(row.p99Ms),
  }));

  return (
    <div className="dash-page">
      <header className="dash-topbar">
        <div className="dash-topbar-inner">
          <div className="dash-brand">
            <i className="ti ti-activity-heartbeat" aria-hidden="true" />
            <span className="dash-brand-title">GraphQL Analytics</span>
            <span className="dash-brand-sep">&middot;</span>
            <span className="dash-brand-subtitle">Operation details</span>
          </div>

          <nav className="dash-nav" aria-label="Primary">
            <Link href="/" className="dash-nav-link">Overview</Link>
            <Link href="/fields" className="dash-nav-link">Fields</Link>
            <Link href="/operations" className="dash-nav-link dash-nav-link-active">Operations</Link>
            <Link href="/schema" className="dash-nav-link">Schema</Link>
            <Link href="/security" className="dash-nav-link">Security</Link>
          </nav>

          <div className="dash-topbar-right">
            <Link href="/operations" className="dash-nav-link">Back to all operations</Link>
          </div>
        </div>
      </header>

      <main className="dash-main">
        <section className="dash-card">
          <p className="metric-label">Selected operation</p>
          <p className="metric-value mono">{operationName || 'N/A'}</p>
        </section>

        {loading && <div className="dash-card dash-loading"><p>Loading operation analytics...</p></div>}
        {error && <div className="dash-card dash-error"><p>{error}</p></div>}

        {!loading && !details && (
          <div className="dash-card dash-loading">
            <p>No analytics found for this operation in the selected window.</p>
          </div>
        )}

        {!loading && details && (
          <>
            <section className="dash-grid-3">
              <article className="dash-card metric-card">
                <p className="metric-label">Calls (24h)</p>
                <p className="metric-value mono">{details.callCount}</p>
              </article>
              <article className="dash-card metric-card">
                <p className="metric-label">Error Rate</p>
                <p className="metric-value mono">{details.errorRate.toFixed(2)}%</p>
              </article>
              <article className="dash-card metric-card">
                <p className="metric-label">Latency p95 / p99</p>
                <p className="metric-value mono">{details.p95Ms.toFixed(0)}ms / {details.p99Ms.toFixed(0)}ms</p>
              </article>
            </section>

            <section className="dash-grid-2">
              <article className="dash-card table-card">
                <div className="table-head">
                  <p><i className="ti ti-chart-line" /> Hourly trend</p>
                  <span className="spark-pill">24h</span>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trend} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="hour" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="left" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: '#1E1E2E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#F1F5F9' }} />
                    <Line yAxisId="left" type="monotone" dataKey="callCount" stroke="#6366F1" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="errorRate" stroke="#F59E0B" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </article>

              <article className="dash-card table-card">
                <div className="table-head">
                  <p><i className="ti ti-chart-bar" /> Resolver breakdown</p>
                  <span className="spark-pill">Top 10 by p99</span>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={resolverChartData} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={200} tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: '#1E1E2E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#F1F5F9' }} />
                    <Bar dataKey="p95" fill="rgba(99,102,241,0.55)" radius={[2, 2, 2, 2]} />
                    <Bar dataKey="p99" fill="#6366F1" radius={[2, 2, 2, 2]} />
                  </BarChart>
                </ResponsiveContainer>
              </article>
            </section>

            <section className="dash-grid-2">
              <article className="dash-card table-card">
                <div className="table-head">
                  <p><i className="ti ti-code" /> Full operation query</p>
                  <span className="spark-pill">latest</span>
                </div>
                <div className="table-body">
                  <div className="table-row" style={{ alignItems: 'start' }}>
                    <pre
                      className="mono"
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        width: '100%',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {details.operationQuery || 'No query captured for this operation yet.'}
                    </pre>
                  </div>
                </div>
              </article>

              <article className="dash-card table-card">
                <div className="table-head">
                  <p><i className="ti ti-braces" /> Request headers</p>
                  <span className="spark-pill">latest</span>
                </div>
                <div className="table-body">
                  <div className="table-row" style={{ alignItems: 'start' }}>
                    <pre
                      className="mono"
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        width: '100%',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {details.requestHeaders
                        ? JSON.stringify(details.requestHeaders, null, 2)
                        : 'No headers captured for this operation yet.'}
                    </pre>
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


