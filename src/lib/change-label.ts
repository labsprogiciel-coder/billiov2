// « Modifié le 12 novembre par Awa » for a catalogue item (PRO-173).

/** Local calendar date (YYYY-MM-DD) of a timestamp. */
function localDay(ts: string): string | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function lastChangeLabel(
  item: { updatedAt?: string; updatedByName?: string },
  fmtDay: (isoDay: string) => string,
): string | null {
  const day = item.updatedAt ? localDay(item.updatedAt) : null;
  if (!day) return null;
  return `Modifié le ${fmtDay(day)}${item.updatedByName ? ` par ${item.updatedByName}` : ''}`;
}
