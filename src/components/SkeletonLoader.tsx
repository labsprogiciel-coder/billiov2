// Loading placeholders. <Page> (src/components/Page.tsx) draws the real header
// and puts one of these bodies under it while the page's data loads.
// PageSkeleton is the same thing for pages that return early while loading.

import type { ReactNode } from 'react';
import Page, { type PageProps } from '@/components/Page';

export type SkeletonVariant = 'default' | 'dashboard' | 'table-only' | 'accounting' | 'document' | 'form';

export interface SkeletonSpec {
  variant?: SkeletonVariant;
  /** number of metric cards (0 to hide metrics row) */
  metrics?: number;
  /** number of table rows */
  rows?: number;
}

interface PageSkeletonProps extends SkeletonSpec {
  title: string;
  subtitle?: ReactNode;
  section?: PageProps['section'];
}

function S({ w, h = 12, r }: { w: number | string; h?: number; r?: number }) {
  return (
    <div
      className="skel"
      style={{ width: w, height: h, borderRadius: r ?? 6 }}
    />
  );
}

/** Two button-shaped placeholders where the header's buttons will be. */
export function SkeletonActions() {
  return (
    <div className="skel-actions" aria-hidden="true">
      <S w={96} h={34} r={8} />
      <S w={120} h={34} r={8} />
    </div>
  );
}

function SkeletonMetrics({ count = 4 }: { count?: number }) {
  return (
    <div className="skel-metrics" style={{ gridTemplateColumns: `repeat(${count},1fr)` }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skel-metric-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <S w={28} h={28} r={7} />
            <S w={90} h={11} />
          </div>
          <S w="70%" h={24} />
          <S w="50%" h={10} />
        </div>
      ))}
    </div>
  );
}

function SkeletonTableRows({ rows = 5, cols = [180, 140, 120, 80, 60] }: { rows?: number; cols?: number[] }) {
  return (
    <div className="skel-table">
      <div className="skel-table-head">
        {cols.map((w, i) => <S key={i} w={w * 0.7} h={10} />)}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel-row">
          {cols.map((_w, j) => (
            <div key={j} style={{ flex: j === 0 ? 2 : 1 }}>
              <S w="80%" h={j === 0 ? 13 : 12} />
              {j === 0 && <S w="55%" h={10} r={4} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <>
      <SkeletonMetrics />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 }}>
        <S w={120} h={14} />
        <S w={60} h={12} />
      </div>
      <SkeletonTableRows rows={4} />
      <div className="skel-bottom-grid">
        {[0, 1].map(i => (
          <div key={i} className="skel-panel">
            <div className="skel-panel-head">
              <S w={140} h={14} />
              <S w={60} h={12} />
            </div>
            <div className="skel-panel-rows">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <S w={32} h={32} r={50} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <S w="70%" h={12} />
                    <S w="45%" h={10} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function SkeletonAccounting({ rows = 6 }: { rows?: number }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 13, marginBottom: 24 }}>
        {[0, 1, 2].map(i => (
          <div key={i} className="skel-metric-card">
            <S w="60%" h={11} />
            <S w="80%" h={22} />
            <S w="40%" h={10} />
          </div>
        ))}
      </div>
      <SkeletonTableRows rows={rows} cols={[200, 120, 100, 80]} />
    </>
  );
}

/** An invoice or quote: the document on the left, summary panels on the right. */
function SkeletonDocument({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skel-doc">
      <div className="skel-panel">
        <div className="skel-panel-head"><S w={160} h={16} /><S w={90} h={12} /></div>
        <div className="skel-doc-parties">
          {[0, 1].map(i => (
            <div key={i} className="skel-panel-rows">
              <S w={70} h={10} /><S w="80%" h={13} /><S w="65%" h={11} /><S w="55%" h={11} />
            </div>
          ))}
        </div>
        <SkeletonTableRows rows={rows} cols={[220, 50, 70, 90, 90]} />
        <div className="skel-doc-totals"><S w={200} h={12} /><S w={200} h={12} /><S w={200} h={18} /></div>
      </div>
      <div className="skel-doc-side">
        {[0, 1].map(i => (
          <div key={i} className="skel-panel">
            <div className="skel-panel-head"><S w={110} h={13} /></div>
            <div className="skel-panel-rows"><S w="90%" h={11} /><S w="75%" h={11} /><S w="60%" h={18} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A settings or editing form: labelled fields in two columns. */
function SkeletonForm({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skel-panel">
      <div className="skel-panel-head"><S w={180} h={14} /></div>
      <div className="skel-form">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skel-panel-rows" style={{ gap: 6 }}>
            <S w={110} h={10} />
            <S w="100%" h={34} r={6} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The body placeholder for a page shape. */
export function SkeletonBody({ variant = 'default', metrics = 4, rows = 6 }: SkeletonSpec) {
  return (
    <div aria-hidden="true">
      {variant === 'dashboard' && <SkeletonDashboard />}
      {variant === 'accounting' && <SkeletonAccounting rows={rows} />}
      {variant === 'document' && <SkeletonDocument rows={rows} />}
      {variant === 'form' && <SkeletonForm rows={rows} />}
      {(variant === 'default' || variant === 'table-only') && (
        <>
          {variant === 'default' && metrics > 0 && <SkeletonMetrics count={metrics} />}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 }}>
            <S w={130} h={14} />
            <div style={{ display: 'flex', gap: 6 }}>
              {[60, 80, 70, 90].map((w, i) => <S key={i} w={w} h={30} r={20} />)}
            </div>
          </div>
          <SkeletonTableRows rows={rows} />
        </>
      )}
    </div>
  );
}

/** A whole page while it loads, for pages that return early. Same header as the loaded page. */
export function PageSkeleton({ title, subtitle, section, ...spec }: PageSkeletonProps) {
  return <Page title={title} subtitle={subtitle} section={section} status="loading" skeleton={spec} />;
}
