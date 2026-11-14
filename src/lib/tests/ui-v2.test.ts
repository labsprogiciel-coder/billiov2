import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyUiV2, UI_V2_FONT_URL, type UiV2Document } from '@/lib/ui-v2';

function fakeDocument() {
  const links: { rel: string; href: string }[] = [];
  const doc: UiV2Document = {
    documentElement: { dataset: {} },
    head: { appendChild: (node) => links.push(node as { rel: string; href: string }) },
    querySelector: (sel) => links.find(l => sel === `link[href="${l.href}"]`) ?? null,
    createElement: () => ({ rel: '', href: '' }),
  };
  return { doc, links };
}

describe('applyUiV2', () => {
  it('marks the page and loads the font once', () => {
    const { doc, links } = fakeDocument();
    applyUiV2(doc);
    applyUiV2(doc);
    expect(doc.documentElement.dataset.ui).toBe('v2');
    expect(links).toEqual([{ rel: 'stylesheet', href: UI_V2_FONT_URL }]);
  });
});

// The ERP block in index.css overrides existing tokens by name: a typo would
// silently leave the old value in place.
describe('ERP tokens in index.css', () => {
  const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`${selector} not found`);
    return css.slice(start, css.indexOf('}', start));
  };
  const names = (text: string) => [...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]);
  const rootTokens = new Set(names(block(':root')));
  const v2 = block('html[data-ui="v2"]');
  const NEW = /^--(nav|row|status)-/;

  it('only overrides tokens that exist, or adds the new nav, row and status tokens', () => {
    const unknown = names(v2).filter(n => !rootTokens.has(n) && !NEW.test(n));
    expect(unknown).toEqual([]);
  });

  it('keeps the original font in template previews', () => {
    const original = /--font-sans:\s*([^;]+);/.exec(block(':root'))![1];
    const preview = /--font-sans:\s*([^;]+);/.exec(block('html[data-ui="v2"] .tp-paper'))![1];
    expect(preview).toBe(original);
  });
});
