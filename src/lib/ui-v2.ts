// Switches the page to the ERP look (PRO-160): sets html[data-ui="v2"], which
// the token overrides in src/index.css key on, and loads its font. Called once
// at startup when UI_V2 is on. The invoice PDF and the template previews keep
// their own fonts and styles.

export const UI_V2_FONT_URL =
  'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&display=swap';

/** The parts of `document` this needs, so it can be tested without a browser. */
export interface UiV2Document {
  documentElement: { dataset: Record<string, string | undefined> };
  head: { appendChild(node: unknown): unknown };
  querySelector(selector: string): unknown;
  createElement(tag: 'link'): { rel: string; href: string };
}

export function applyUiV2(doc: UiV2Document = document as unknown as UiV2Document): void {
  doc.documentElement.dataset.ui = 'v2';
  if (!doc.querySelector(`link[href="${UI_V2_FONT_URL}"]`)) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = UI_V2_FONT_URL;
    doc.head.appendChild(link);
  }
}
