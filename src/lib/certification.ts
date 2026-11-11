// Security elements a certified electronic invoice must carry (Arrêté
// n°2025-0047/MEF/SG/DGI; DGI spec v2.0, note n°2025-0889): the SECeF/DGI
// code, the SECeF identifier, counters, the control module's (MCF) date and
// time, and the QR code. The MCF returns them when the invoice is certified
// (PRO-137); they are printed in a fixed area of every invoice template
// (PRO-135). The QR code's content follows the MCF protocol (spec 2.30).

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
