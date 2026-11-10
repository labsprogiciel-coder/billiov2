// Elements a certified electronic invoice (FEC, through SECeF) must carry:
// the SECeF identification number, a unique transaction code and a QR code
// (Arrêté n°2025-0049/MEF/SG/DGI). They are returned by the DGI's system when
// the invoice is certified (PRO-137) and printed in a fixed area of every
// invoice template (PRO-135). The exact list is still to be checked against
// the official texts (PRO-132).

import QRCode from 'qrcode';

export interface InvoiceCertification {
  /** SECeF / MCF identification number */
  secefId:         string;
  /** Unique code of this invoice, returned on certification */
  transactionCode: string;
  /** Text encoded in the QR code (verification link or signed data) */
  qrPayload:       string;
  /** ISO date-time of certification */
  certifiedAt?:    string;
  /** Invoice counter returned by the module, when there is one */
  counter?:        string;
}

export interface QrMatrix { size: number; dark: (x: number, y: number) => boolean }

/** QR code modules for `text` (error correction M, as scanners expect on paper). */
export function qrMatrix(text: string): QrMatrix {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  return { size: modules.size, dark: (x, y) => Boolean(modules.get(y, x)) };
}

/**
 * Dark modules as horizontal runs, so a QR code is drawn with one rectangle per
 * run instead of one per module (keeps the PDF small).
 */
export function qrRuns(m: QrMatrix): { x: number; y: number; w: number }[] {
  const runs: { x: number; y: number; w: number }[] = [];
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.dark(x, y)) { x++; continue; }
      const start = x;
      while (x < m.size && m.dark(x, y)) x++;
      runs.push({ x: start, y, w: x - start });
    }
  }
  return runs;
}
