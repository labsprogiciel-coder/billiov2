// Amount in French words, for the "arrêtée la présente facture à la somme de…"
// mention (DGI spec v2.0, section 3 t). Traditional spelling: hyphens below
// one hundred, "et" in 21…71, "quatre-vingts" and "deux cents" plural only at
// the end of the number, "mille" invariable.

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

/** 0…99. `final`: nothing follows (only then does quatre-vingts take an s). */
function below100(n: number, final: boolean): string {
  if (n <= 16) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n < 70) {
    const t = Math.floor(n / 10), u = n % 10;
    if (u === 0) return TENS[t];
    return u === 1 ? `${TENS[t]} et un` : `${TENS[t]}-${UNITS[u]}`;
  }
  if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${below100(n - 60, false)}`;
  if (n === 80) return final ? 'quatre-vingts' : 'quatre-vingt';
  return `quatre-vingt-${below100(n - 80, false)}`;
}

/** 0…999 */
function below1000(n: number, final: boolean): string {
  const h = Math.floor(n / 100), r = n % 100;
  if (h === 0) return below100(r, final);
  const hundreds = h === 1 ? 'cent' : `${UNITS[h]} cent${r === 0 && final ? 's' : ''}`;
  return r === 0 ? hundreds : `${hundreds} ${below100(r, final)}`;
}

/** Whole number in French words: 118000 → "cent dix-huit mille". */
export function numberInWords(value: number): string {
  let n = Math.round(Math.abs(value));
  if (n === 0) return 'zéro';
  const parts: string[] = [];
  const scales: [number, string, string][] = [[1e9, 'milliard', 'milliards'], [1e6, 'million', 'millions']];
  for (const [size, one, many] of scales) {
    const k = Math.floor(n / size);
    if (k > 0) { parts.push(`${below1000(k, true)} ${k > 1 ? many : one}`); n %= size; }
  }
  const thousands = Math.floor(n / 1000);
  if (thousands > 0) {
    parts.push(thousands === 1 ? 'mille' : `${below1000(thousands, false)} mille`);
    n %= 1000;
  }
  if (n > 0) parts.push(below1000(n, true));
  return (value < 0 ? 'moins ' : '') + parts.join(' ');
}

/**
 * The total in words: "Arrêtée la présente facture à la somme de cent
 * dix-huit mille francs CFA." (a quote: "Arrêté le présent devis …").
 */
export function invoiceTotalMention(amount: number, document: 'facture' | 'devis' = 'facture'): string {
  const doc = document === 'devis' ? 'Arrêté le présent devis' : 'Arrêtée la présente facture';
  return `${doc} à la somme de ${numberInWords(amount)} francs CFA.`;
}
