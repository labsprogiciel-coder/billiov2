import { lazy, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import TopNav from '@/components/TopNav';
import Icon from '@/components/Icon';
import Toast from '@/components/Toast';
import { useApp } from '@/context/AppContext';
import { ASSISTANT_ENABLED } from '@/lib/features';

// Its own chunk, and only built when the assistant is switched on: with the
// flag off the import is dropped, so CopilotKit adds nothing to the app or its
// offline cache
const Assistant = ASSISTANT_ENABLED ? lazy(() => import('@/components/Assistant')) : null;

export default function AppShell({ onLogout }: { onLogout: () => void }) {
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
        <Toast />
      </div>
    </div>
  );
}
