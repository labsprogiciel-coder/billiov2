// The business documents (KYB) expected from a client, by DGI client type
// (PRO-169 shows them on the client record; storing the files comes with
// PRO-176). A proposal to confirm: the list and the validity periods.

import type { ClientType } from '@/lib/client-type';

export interface KybDoc {
  key: string;
  label: string;
  /** How long a copy stays valid, when it expires. */
  validity?: string;
}

const RCCM: KybDoc = { key: 'rccm', label: 'Extrait RCCM' };
const IFU: KybDoc = { key: 'ifu', label: 'Attestation IFU' };
const ASF: KybDoc = { key: 'asf', label: 'Attestation de situation fiscale', validity: '3 mois' };
const STATUTS: KybDoc = { key: 'statuts', label: 'Statuts de la société' };
const CNIB_REP: KybDoc = { key: 'cnib-rep', label: 'CNIB du représentant légal' };
const CNIB: KybDoc = { key: 'cnib', label: 'CNIB ou passeport' };
const RIB: KybDoc = { key: 'rib', label: 'RIB' };

export const KYB_DOCS: Record<ClientType, KybDoc[]> = {
  PM: [RCCM, IFU, ASF, STATUTS, CNIB_REP, RIB],
  PC: [RCCM, IFU, ASF, CNIB],
  PP: [CNIB],
  CC: [],
};
