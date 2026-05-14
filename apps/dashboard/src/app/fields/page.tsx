'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';

interface FieldUsage {
  typeName: string;
  fieldName: string;
  callCount: number;
  errorCount: number;
}

export default function FieldsPage() {
  const [fields, setFields] = useState<FieldUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const fetchFields = async () => {
      try {
        const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const to = new Date();
        const result = await trpc.fields.fieldUsage.query({ from, to, limit: 100 });
        setFields(result || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchFields();
  }, []);

  const maxCalls = Math.max(...fields.map((f) => f.callCount), 1);
  const grouped = fields.reduce<Record<string, FieldUsage[]>>((acc, f) => {
    if (!acc[f.typeName]) acc[f.typeName] = [];
    acc[f.typeName].push(f);
    return acc;
  }, {});

  const filteredTypes = Object.keys(grouped).filter((t) =>
    t.toLowerCase().includes(filter.toLowerCase())
  );

  const totalCalls = fields.reduce((sum, f) => sum + f.callCount, 0);

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
            <Link href="/fields" className="dash-nav-link dash-nav-link-active">Fields</Link>
            <Link href="/operations" className="dash-nav-link">Operations</Link>
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
            <p className="metric-label">Tracked Fields</p>
            <p className="metric-value">{fields.length}</p>
            <span className="metric-pill metric-pill-success">Across all types</span>
          </article>
          <article className="dash-card metric-card">
            <p className="metric-label">Total Calls (7d)</p>
            <p className="metric-value mono">{totalCalls}</p>
            <span className="metric-pill metric-pill-success">↑ Active traffic</span>
          </article>
          <article className="dash-card metric-card">
            <p className="metric-label">Type Filter</p>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by type (e.g. User)"
              className="dash-filter-input"
            />
          </article>
        </section>

        {loading && <div className="dash-card dash-loading"><p>Loading fields...</p></div>}
        {error && (
          <div className="dash-card dash-error">
            {error}
          </div>
        )}

        {!loading && fields.length === 0 && (
          <div className="dash-card dash-loading">
            <p>No field usage data yet. Integrate the SDK to start tracking.</p>
          </div>
        )}

        {filteredTypes.map((typeName) => (
          <article key={typeName} className="dash-card table-card">
            <div className="table-head">
              <p><i className="ti ti-box-multiple-1" style={{ color: 'var(--accent)' }} /> {typeName}</p>
              <span className="spark-pill">{grouped[typeName].length} fields</span>
            </div>
            <div className="table-body">
              {grouped[typeName].map((f) => (
                <div className="table-row" key={`${typeName}.${f.fieldName}`} title={`${f.callCount} calls, ${f.errorCount} errors`}>
                  <div className="row-name mono">
                    <span className="prefix accent">{typeName}.</span>
                    <span>{f.fieldName}</span>
                  </div>
                  <div className="row-metric">
                    <span className="mono">{f.callCount.toLocaleString()}</span>
                    <span className="mini-bar">
                      <span style={{ width: `${Math.max(8, Math.round((f.callCount / maxCalls) * 100))}%` }} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}

        {!loading && filteredTypes.length === 0 && filter && (
          <div className="dash-card dash-loading">
            <p>No types matching &quot;{filter}&quot;</p>
          </div>
        )}
      </main>
    </div>
  );
}

