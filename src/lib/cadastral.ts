// Cadastral reference of the place of sale (DGI spec v2.0, section 3 c):
// section (4 digits), îlot (3) and parcelle (4), printed as "SSSS LLL PPPP".

/** The 11 digits, or null when the input isn't a complete reference. */
export function parseCadastralRef(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

/** "SSSS LLL PPPP" (an incomplete value is returned as typed). */
export function formatCadastralRef(stored: string | null | undefined): string {
  const d = (stored ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : (stored ?? '');
}

/** The DGI reference is Burkina-specific: required for organisations there (or with no country yet). */
export function cadastralRequired(country: string | undefined): boolean {
  const c = (country ?? '').trim().toLowerCase();
  return c === '' || c === 'burkina faso' || c === 'bf';
}
