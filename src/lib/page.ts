// Helpers for <Page> (src/components/Page.tsx).

/** "Devis · Billio": the browser tab title for a page. */
export function documentTitleFor(title: string): string {
  const t = title.trim();
  return t ? `${t} · Billio` : 'Billio';
}

/**
 * Whether opening a page should move keyboard focus to its heading, so screen
 * readers announce the new page. Not while the user is typing in a field.
 */
export function shouldMoveFocus(active: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!active) return true;
  if (active.isContentEditable) return false;
  return !['INPUT', 'TEXTAREA', 'SELECT'].includes((active.tagName ?? '').toUpperCase());
}
