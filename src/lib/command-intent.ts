// What the command box (PRO-162) asks a page to do once it has navigated
// there: open a « new » panel, open a client, show the late invoices. It
// travels in the history entry's state, so it also works when that page is
// already open, and is cleared once done so Back doesn't replay it.

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export type CommandIntent =
  | { command: 'new-invoice'; client?: string }
  | { command: 'new-quote'; client?: string }
  | { command: 'new-payment' }
  | { command: 'new-client' }
  | { command: 'open-client'; client: string }
  | { command: 'show-late' };

export function readIntent(state: unknown): CommandIntent | null {
  const s = state as { intent?: CommandIntent } | null;
  return s?.intent && typeof s.intent.command === 'string' ? s.intent : null;
}

/** State to pass to navigate() so the target page runs `intent`. */
export const withIntent = (intent: CommandIntent) => ({ state: { intent } });

/**
 * Runs `handle` for each intent sent to this page (once per navigation), when
 * `ready` (e.g. once the page's data has loaded). Return false from `handle`
 * to leave an intent this page doesn't take.
 */
export function useCommandIntent(handle: (intent: CommandIntent) => boolean | void, ready = true) {
  const location = useLocation();
  const navigate = useNavigate();
  const seen = useRef<string | null>(null);
  // Kept until the page is ready: the page may rewrite its URL meanwhile
  // (e.g. ?tab=), which drops the history state the intent came in
  const pending = useRef<CommandIntent | null>(null);
  const handleRef = useRef(handle);
  useEffect(() => { handleRef.current = handle; });

  useEffect(() => {
    const intent = readIntent(location.state);
    if (intent && seen.current !== location.key) {
      seen.current = location.key;
      pending.current = intent;
    }
    if (!ready || !pending.current) return;
    const todo = pending.current;
    pending.current = null;
    if (handleRef.current(todo) === false) return;
    // Same page, no state: Back won't reopen the panel
    if (readIntent(location.state)) navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location, navigate, ready]);
}
