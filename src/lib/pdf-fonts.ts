// Fonts of the invoice templates, bundled with the app (no CDN at PDF time) and
// registered with the PDF engine. Imported only by InvoicePDF, which is itself
// loaded on demand. The latin subset covers French and the F CFA formatting.
// IBM Plex Mono comes from IBM's own package: fontkit can't read the glyph data
// of the fontsource .woff files, nor subset .woff2 files.
import { Font } from '@react-pdf/renderer';
import jakarta400 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff?url';
import jakarta700 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff?url';
import grotesk400 from '@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff?url';
import grotesk700 from '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff?url';
import lora400 from '@fontsource/lora/files/lora-latin-400-normal.woff?url';
import lora700 from '@fontsource/lora/files/lora-latin-700-normal.woff?url';
import plex400 from '@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Regular.woff?url';
import plex700 from '@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Bold.woff?url';
import type { PdfFont } from '@/lib/invoice-template';

export type PdfFontFiles = Record<PdfFont, [regular: string, bold: string]>;

export const PDF_FONT_FILES: PdfFontFiles = {
  Jakarta: [jakarta400, jakarta700],
  Grotesk: [grotesk400, grotesk700],
  Lora:    [lora400, lora700],
  Plex:    [plex400, plex700],
};

let registered = false;
export function registerPdfFonts(files: PdfFontFiles = PDF_FONT_FILES) {
  if (registered) return;
  registered = true;
  for (const [family, [regular, bold]] of Object.entries(files)) {
    Font.register({ family, fonts: [{ src: regular, fontWeight: 400 }, { src: bold, fontWeight: 700 }] });
  }
  // Don't hyphenate client names, IFU numbers or amounts
  Font.registerHyphenationCallback(word => [word]);
}
