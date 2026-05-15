'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';

interface DeprecatedFieldRow {
  typeName: string;
  fieldName: string;
  deprecated: boolean;
  deprecationReason: string | null;
  callCount: number;
  lastSeenAt: string | null;
  safeToRemove: boolean;
}

interface UnusedFieldRow {
  typeName: string;
  fieldName: string;
  deprecated: boolean;
  deprecationReason: string | null;
  safeToRemove: boolean;
}

export default function SchemaPage() {
  const [deprecatedFields, setDeprecatedFields] = useState<DeprecatedFieldRow[]>([]);
  const [unusedFields, setUnusedFields] = useState<UnusedFieldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [deprecated, unused] = await Promise.all([
          trpc.schema.deprecatedFields.query({ days: 30 }),
          trpc.schema.unusedFields.query({ days: 30 }),
        ]);
        setDeprecatedFields(deprecated || []);
        setUnusedFields(unused || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const safeToRemoveCount = useMemo(
    () => deprecatedFields.filter((field) => field.safeToRemove).length,
    [deprecatedFields]
  );

  return (
    <div className="dash-page">
      <header className="dash-topbar">
        <div className="dash-topbar-inner">
          <div className="dash-brand">
            <i className="ti ti-activity-heartbeat" aria-hidden="true" />
            <span className="dash-brand-title">GraphQL Analytics</span>
            <span className="dash-brand-sep">&middot;</span>
            <span className="dash-brand-subtitle">Schema analytics</span>
          </div>

          <nav className="dash-nav" aria-label="Primary">
            <Link href="/" className="dash-nav-link">Overview</Link>
            <Link href="/fields" className="dash-nav-link">Fields</Link>
            <Link href="/operations" className="dash-nav-link">Operations</Link>
            <Link href="/schema" className="dash-nav-link dash-nav-link-active">Schema</Link>
            <Link href="/security" className="dash-nav-link">Security</Link>
          </nav>

          <div className="dash-topbar-right">
            <span className="live-dot" aria-hidden="true" />
            <span className="dash-live-label">Live</span>
            <span className="dash-updated">30d schema usage</span>
          </div>
        </div>
      </header>

      <main className="dash-main">
        <section className="dash-grid-3">
          <article className="dash-card metric-card">
            <p className="metric-label">Deprecated Fields</p>
            <p className="metric-value mono">{deprecatedFields.length}</p>
            <span className="metric-pill metric-pill-success">Parsed from SDL</span>
          </article>
          <article className="dash-card metric-card">
            <p className="metric-label">Safe to Remove</p>
            <p className="metric-value mono">{safeToRemoveCount}</p>
            <span className="metric-pill metric-pill-success">No calls in 30d</span>
          </article>
          <article className="dash-card metric-card">
            <p className="metric-label">Unused Fields</p>
            <p className="metric-value mono">{unusedFields.length}</p>
            <span className="metric-pill" style={{ color: 'var(--warning)', background: 'rgba(245,158,11,0.12)' }}>Candidate cleanup</span>
          </article>
        </section>

        {loading && <div className="dash-card dash-loading"><p>Loading schema analytics...</p></div>}
        {error && <div className="dash-card dash-error">{error}</div>}

        {!loading && (
          <section className="dash-grid-2">
            <article className="dash-card table-card">
              <div className="table-head">
                <p><i className="ti ti-alert-triangle" style={{ color: 'var(--warning)' }} /> Deprecated Fields</p>
                <span className="spark-pill">30d calls</span>
              </div>
              <div className="table-body">
                {deprecatedFields.map((field, idx) => (
                  <div className="table-row" key={`${field.typeName}.${field.fieldName}.${idx}`}>
                    <div className="row-name mono">
                      <span className="prefix warn">{field.typeName}.</span>
                      <span>{field.fieldName}</span>
                    </div>
                    <div className="row-metric">
                      <span className="mono">{field.callCount}</span>
                      <span className="mono" style={{ color: field.safeToRemove ? 'var(--success)' : 'var(--text-secondary)' }}>
                        {field.safeToRemove ? 'safe' : 'in use'}
                      </span>
                    </div>
                  </div>
                ))}
                {!deprecatedFields.length && <div className="table-row"><div className="row-name"><span>No deprecated fields found in schema.</span></div></div>}
              </div>
            </article>

            <article className="dash-card table-card">
              <div className="table-head">
                <p><i className="ti ti-scan-eye" style={{ color: 'var(--accent)' }} /> Unused Fields</p>
                <span className="spark-pill">No calls in 30d</span>
              </div>
              <div className="table-body">
                {unusedFields.slice(0, 50).map((field, idx) => (
                  <div className="table-row" key={`${field.typeName}.${field.fieldName}.${idx}`}>
                    <div className="row-name mono">
                      <span className="prefix accent">{field.typeName}.</span>
                      <span>{field.fieldName}</span>
                    </div>
                    <div className="row-metric">
                      <span className="mono" style={{ color: field.deprecated ? 'var(--warning)' : 'var(--text-secondary)' }}>
                        {field.deprecated ? 'deprecated' : 'idle'}
                      </span>
                    </div>
                  </div>
                ))}
                {!unusedFields.length && <div className="table-row"><div className="row-name"><span>No unused schema fields in the last 30 days.</span></div></div>}
              </div>
            </article>
          </section>
        )}
      </main>
    </div>
  );
}

