// Client types of the DGI specification (spec v2.0, 2.14 and annexe "Types du
// client"). The type is printed on the invoice and decides which client
// fields are mandatory: name always, and the IFU for companies (PM) and
// individual traders (PC).

export type ClientType = 'CC' | 'PM' | 'PP' | 'PC';

export interface ClientTypeDef {
  code:        ClientType;
  label:       string;
  /** Mention printed on the invoice */
  mention:     string;
  ifuRequired: boolean;
}

export const CLIENT_TYPES: readonly ClientTypeDef[] = [
  { code: 'PM', label: 'Personne morale (entreprise)', mention: '[PM] Personne morale', ifuRequired: true },
  { code: 'PC', label: 'Personne physique commerçant', mention: '[PC] Personne physique commerçant', ifuRequired: true },
  { code: 'PP', label: 'Personne physique (particulier)', mention: '[PP] Personne physique', ifuRequired: false },
  { code: 'CC', label: 'Client comptant', mention: '[CC] Client comptant', ifuRequired: false },
];

export function isClientType(v: unknown): v is ClientType {
  return typeof v === 'string' && CLIENT_TYPES.some(t => t.code === v);
}

/** The client's type; clients saved before types existed: PM with an IFU, PP without. */
export function clientTypeOf(c: { clientType?: string | null; ifu?: string }): ClientType {
  if (isClientType(c.clientType)) return c.clientType;
  return c.ifu && c.ifu.trim() ? 'PM' : 'PP';
}

export const clientTypeDef = (t: ClientType): ClientTypeDef => CLIENT_TYPES.find(d => d.code === t)!;
