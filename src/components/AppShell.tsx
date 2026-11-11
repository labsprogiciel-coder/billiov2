import { lazy, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';
import Icon from '@/components/Icon';
import { useToast } from '@/context/ToastContext';
import { ASSISTANT_ENABLED } from '@/lib/features';

// Its own chunk, and only built when the assistant is switched on: with the
// flag off the import is dropped, so CopilotKit adds nothing to the app or its
// offline cache
const Assistant = ASSISTANT_ENABLED ? lazy(() => import('@/components/Assistant')) : null;

export default function AppShell({ onLogout }: { onLogout: () => void }) {
  const { toastMsg, toastVisible, toastError } = useToast();

  return (
    <div className="app">
      <Sidebar onLogout={onLogout} />
      <div className="main-rel">
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
