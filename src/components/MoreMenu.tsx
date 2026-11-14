// « ⋯ » button with a short menu of less common actions. Arrows move,
// Escape closes and gives focus back to the button.

import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/Icon';

export interface MoreMenuItem { label: string; icon?: string; danger?: boolean; disabled?: boolean; run: () => void }

export default function MoreMenu({ label, items, className = 'btn' }: { label: string; items: MoreMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (e: Event) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
      if (!list.length) return;
      e.preventDefault();
      const i = list.indexOf(document.activeElement as HTMLElement);
      list[e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length].focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('focusin', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('focusin', away); document.removeEventListener('keydown', key); };
  }, [open]);
  if (!items.length) return null;
  return (
    <div className="dt-menu-root" ref={rootRef}>
      <button ref={btnRef} type="button" className={`${className} more-btn`} aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(o => !o)}>
        <Icon name="dots" size={16} ariaHidden />
      </button>
      {open && (
        <div className="dt-menu" role="menu" aria-label={label}>
          {items.map(it => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled} className={`dt-mi${it.danger ? ' danger' : ''}`} onClick={() => { setOpen(false); it.run(); }}>
              {it.icon && <Icon name={it.icon} size={15} ariaHidden />}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
