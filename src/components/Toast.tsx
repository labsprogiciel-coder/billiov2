import Icon from '@/components/Icon';
import { useToast } from '@/context/ToastContext';

/** The message that slides in after an action (« showToast »). One per screen. */
export default function Toast() {
  const { toastMsg, toastVisible, toastError } = useToast();
  return (
    <div
      className={`toast${toastVisible ? ' show' : ''}`}
      role={toastError ? 'alert' : 'status'}
      aria-live={toastError ? 'assertive' : 'polite'}
    >
      <Icon name={toastError ? 'alert-triangle' : 'circle-check-filled'} ariaHidden style={{ color: toastError ? '#F0A0A0' : '#7BD17B' }} />
      <span>{toastMsg}</span>
    </div>
  );
}
