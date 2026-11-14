// Search behind the command box (PRO-162): clients, invoices and quotes held
// in AppContext, matched on the client side. Each record's text is lowered
// and stripped of accents once (buildIndex); a query is then one pass over
// plain strings, quick enough for thousands of invoices on every keystroke.

/** A part of a result's text, marked when it matched the query. */
export interface Chunk { text: string; hit: boolean }

export interface Indexed<T> {
  item: T;
  /** Searchable text, folded (see fold). */
  hay: string;
  /** Text matched at its start ranks first (a number, a name). */
  primary: string;
}

/** One character at a time, so positions in the folded text map back to the original. */
function foldChar(c: string): string {
  return c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Lower case, no accents: « Échéance » → « echeance ». Keeps the length of plain text. */
export function fold(text: string): string {
  let out = '';
  for (const c of text) out += foldChar(c);
  return out;
}

export function queryWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

export function buildIndex<T>(items: T[], fields: (item: T) => { primary: string; rest: (string | undefined)[] }): Indexed<T>[] {
  return items.map(item => {
    const f = fields(item);
    const primary = fold(f.primary);
    return { item, primary, hay: [primary, ...f.rest.filter(Boolean).map(s => fold(s as string))].join(' ') };
  });
}

/**
 * Items whose text has every word of the query, best first: the primary
 * text starting with the query, then a word of it starting so, then the rest.
 * Stops after `limit` (and doesn't sort more than it needs).
 */
export function searchIndex<T>(index: Indexed<T>[], query: string, limit: number): T[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const whole = words.join(' ');
  const tiers: T[][] = [[], [], []];
  for (const e of index) {
    if (!words.every(w => e.hay.includes(w))) continue;
    const tier = e.primary.startsWith(whole) ? 0 : (' ' + e.primary).includes(' ' + words[0]) ? 1 : 2;
    tiers[tier].push(e.item);
    // Enough top results: the rest can't outrank them
    if (tiers[0].length >= limit) break;
  }
  return tiers.flat().slice(0, limit);
}

/** Splits `text` so the parts matching any query word are marked. */
export function highlight(text: string, query: string): Chunk[] {
  const words = queryWords(query);
  if (!words.length || !text) return [{ text, hit: false }];
  // Folding one character at a time keeps one folded character per original
  // one, except for rare letters that fold to several (e.g. « ß »): map them
  const chars = [...text];
  const folded: string[] = chars.map(foldChar);
  const flat = folded.join('');
  const owner: number[] = [];
  folded.forEach((f, i) => { for (let k = 0; k < f.length; k++) owner.push(i); });
  const marked = new Array<boolean>(chars.length).fill(false);
  for (const w of words) {
    for (let at = flat.indexOf(w); at !== -1; at = flat.indexOf(w, at + 1)) {
      for (let k = at; k < at + w.length; k++) marked[owner[k]] = true;
    }
  }
  const out: Chunk[] = [];
  chars.forEach((c, i) => {
    const last = out[out.length - 1];
    if (last && last.hit === marked[i]) last.text += c;
    else out.push({ text: c, hit: marked[i] });
  });
  return out;
}
