// One page of the app (PRO-181): its header (title, subtitle, buttons), its
// content, and its loading and error states. Every page in src/pages renders
// through this, so the header is drawn in one place: the ERP redesign (top bar,
// PRO-161) and the old look differ only in CSS (html[data-ui="v2"]).
//
// While loading, the real header shows at once and only the body shows a
// skeleton shaped like the page, so the title can't drift between the two.

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import Icon from '@/components/Icon';
import { SkeletonBody, SkeletonActions, type SkeletonSpec } from '@/components/SkeletonLoader';
import { documentTitleFor, shouldMoveFocus } from '@/lib/page';

export type PageStatus = 'ready' | 'loading' | 'error';

export interface PageProps {
  /** The page's heading. Also the browser tab title when it is a string. */
  title: ReactNode;
  /** Tab title when `title` isn't plain text (e.g. "Facture FACT-2026-0031"). */
  documentTitle?: string;
  subtitle?: ReactNode;
  /** The area the page belongs to, shown small above the title (e.g. Comptabilité). */
  section?: { icon?: string; label: string };
  /** Shows a back button before the title (detail pages). */
  back?: { label: string; onClick: () => void };
  /** Buttons on the right of the header. Hidden while loading. */
  actions?: ReactNode;
  status?: PageStatus;
  /** Shape of the loading skeleton. */
  skeleton?: SkeletonSpec;
  /** Shown when status is 'error'. */
  errorMessage?: ReactNode;
  onRetry?: () => void;
  /** Rendered inside the page after the content (side panels, overlays). */
  after?: ReactNode;
  mainStyle?: CSSProperties;
  contentStyle?: CSSProperties;
  titleStyle?: CSSProperties;
  children?: ReactNode;
}

export default function Page({
  title, documentTitle, subtitle, section, back, actions,
  status = 'ready', skeleton, errorMessage, onRetry,
  after, mainStyle, contentStyle, titleStyle, children,
}: PageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tabTitle = documentTitle ?? (typeof title === 'string' ? title : undefined);

  useEffect(() => {
    if (!tabTitle) return;
    const previous = document.title;
    document.title = documentTitleFor(tabTitle);
    return () => { document.title = previous; };
  }, [tabTitle]);

  useEffect(() => {
    if (shouldMoveFocus(document.activeElement as HTMLElement | null)) {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const heading = back ? (
    <div className="crumbs">
      <button className="crumb-back" onClick={back.onClick} aria-label={back.label}>
        <Icon name="arrow-left" ariaHidden />
      </button>
      <h1 ref={headingRef} tabIndex={-1} className="page-h1 crumb-text" style={titleStyle}>{title}</h1>
    </div>
  ) : (
    <div>
      {section && (
        <div className="page-section">
          {section.icon && <Icon name={section.icon} size={13} ariaHidden />}
          {section.label}
        </div>
      )}
      <h1 ref={headingRef} tabIndex={-1} className="page-h1 page-title" style={titleStyle}>{title}</h1>
      {subtitle && <div className="page-sub">{subtitle}</div>}
    </div>
  );

  return (
    <div className="main" style={mainStyle} aria-busy={status === 'loading' || undefined}>
      <div className="topbar">
        {heading}
        {status === 'loading'
          ? <SkeletonActions />
          : actions && <div className="topbar-actions">{actions}</div>}
      </div>

      <div className="content" style={contentStyle}>
        {status === 'loading' ? <SkeletonBody {...skeleton} />
          : status === 'error' ? <PageError message={errorMessage} onRetry={onRetry} />
          : children}
      </div>
      {after}
    </div>
  );
}

function PageError({ message, onRetry }: { message?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="page-error" role="alert">
      <Icon name="alert-triangle" size={22} ariaHidden />
      <div className="page-error-title">{message ?? 'Cette page n’a pas pu être chargée.'}</div>
      <div className="page-error-sub">Vérifiez votre connexion, puis réessayez.</div>
      {onRetry && <button className="btn" onClick={onRetry}><Icon name="refresh" ariaHidden /> Réessayer</button>}
    </div>
  );
}
