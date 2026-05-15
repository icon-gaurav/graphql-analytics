'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';

interface ComplexityOverview {
  available: boolean;
  avgDepth: number;
  maxDepth: number;
  avgComplexity: number;
  maxComplexity: number;
  highRiskRequests: number;
}

interface ComplexQueryRow {
  operationName: string;
  operationType: string;
  clientName: string;
  callCount: number;
  errorCount: number;
  avgDepth: number;
  maxDepth: number;
  avgComplexity: number;
  maxComplexity: number;
  p95DurationMs: number;
}

export default function SecurityPage() {
  const [overview, setOverview] = useState<ComplexityOverview | null>(null);
  const [queries, setQueries] = useState<ComplexQueryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const to = new Date();
        const [overviewResult, queryResult] = await Promise.all([
          trpc.security.complexityOverview.query({ from, to }),
          trpc.security.complexQueries.query({ from, to, limit: 25 }),
        ]);
        setOverview(overviewResult);
        setQueries(queryResult || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="dash-page">
      <header className="dash-topbar">
        <div className="dash-topbar-inner">
          <div className="dash-brand">
            <i className="ti ti-activity-heartbeat" aria-hidden="true" />
            <span className="dash-brand-title">GraphQL Analytics</span>
            <span className="dash-brand-sep">&middot;</span>
            <span className="dash-brand-subtitle">Security & complexity</span>
          </div>

          <nav className="dash-nav" aria-label="Primary">
            <Link href="/" className="dash-nav-link">Overview</Link>
            <Link href="/fields" className="dash-nav-link">Fields</Link>
            <Link href="/operations" className="dash-nav-link">Operations</Link>
            <Link href="/schema" className="dash-nav-link">Schema</Link>
            <Link href="/security" className="dash-nav-link dash-nav-link-active">Security</Link>
          </nav>

          <div className="dash-topbar-right">
            <span className="live-dot" aria-hidden="true" />
            <span className="dash-live-label">Live</span>
            <span className="dash-updated">Query-shape analytics</span>
          </div>
        </div>
      </header>

      <main className="dash-main">
        <section className="dash-grid-3">
          <article className="dash-card metric-card">
            <p className="metric-label">Average Depth</p>
            <p className="metric-value mono">{overview ? overview.avgDepth.toFixed(1) : '—'}</p>
            <span className="metric-pill metric-pill-success">24h</span>
          </article>
          <article className="dash-card metric-card">
            <p className="metric-label">Max Complexity</p>
            <p className="metric-value mono">{overview ? overview.maxComplexity.toFixed(0) : '—'}</p>
            <span className="metric-pill" style={{ color: 'var(--warning)', background: 'rgba(245,158,11,0.12)' }}>Estimated score</span>
          </article>
          <article className="dash-card metric-card">
            <p className="metric-label">High Risk Requests</p>
            <p className="metric-value mono">{overview ? overview.highRiskRequests : '—'}</p>
            <span className="metric-pill" style={{ color: 'var(--danger)', background: 'rgba(239,68,68,0.12)' }}>Depth ≥ 8 or score ≥ 50</span>
          </article>
        </section>

        {loading && <div className="dash-card dash-loading"><p>Loading security analytics...</p></div>}
        {error && <div className="dash-card dash-error">{error}</div>}

        {!loading && overview && !overview.available && (
          <div className="dash-card dash-loading">
            <p>Complexity metrics are not available yet. Apply the latest database migration and restart the SDK/collector to populate query depth and complexity data.</p>
          </div>
        )}

        {!loading && overview?.available && (
          <article className="dash-card table-card">
            <div className="table-head">
              <p><i className="ti ti-shield-lock" style={{ color: 'var(--danger)' }} /> Complex Queries</p>
              <span className="spark-pill">24h outliers</span>
            </div>
            <div className="table-body">
              {queries.map((query, idx) => (
                <div className="table-row" key={`${query.operationName}.${query.clientName}.${idx}`}>
                  <div className="row-name mono">
                    <span className="prefix warn">{query.operationType} </span>
                    <span>{query.operationName}</span>
                  </div>
                  <div className="row-metric">
                    <span className="mono">d{query.maxDepth}</span>
                    <span className="mono">c{query.maxComplexity}</span>
                    <span className="mono">{query.p95DurationMs.toFixed(0)}ms</span>
                  </div>
                </div>
              ))}
              {!queries.length && <div className="table-row"><div className="row-name"><span>No complex queries recorded yet.</span></div></div>}
            </div>
          </article>
        )}
      </main>
    </div>
  );
}

