import { lazy, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import TopNav from '@/components/TopNav';
import Icon from '@/components/Icon';
import { useToast } from '@/context/ToastContext';
import { useApp } from '@/context/AppContext';
import { ASSISTANT_ENABLED } from '@/lib/features';

// Its own chunk, and only built when the assistant is switched on: with the
// flag off the import is dropped, so CopilotKit adds nothing to the app or its
// offline cache
const Assistant = ASSISTANT_ENABLED ? lazy(() => import('@/components/Assistant')) : null;

export default function AppShell({ onLogout }: { onLogout: () => void }) {
  const { toastMsg, toastVisible, toastError } = useToast();
  const { userRole, loading } = useApp();

  return (
    <div className="app">
      <TopNav onLogout={onLogout} />
      <div className="main-rel">
        {/* Observers (PRO-174): every page opens, nothing changes */}
        {!loading && userRole === 'observer' && (
          <div className="readonly-banner" role="status">
            <Icon name="eye" size={14} ariaHidden /> <b>Lecture seule</b> · vous pouvez tout consulter et exporter.
          </div>
        )}
        <Outlet />
        {Assistant && <Suspense fallback={null}><Assistant /></Suspense>}
        <div
          className={`toast${toastVisible ? ' show' : ''}`}
          role={toastError ? 'alert' : 'status'}
          aria-live={toastError ? 'assertive' : 'polite'}
        >
          <Icon name={toastError ? 'alert-triangle' : 'circle-check-filled'} ariaHidden style={{ color: toastError ? '#F0A0A0' : '#7BD17B' }} />
          <span>{toastMsg}</span>
        </div>
      </div>
    </div>
  );
}
