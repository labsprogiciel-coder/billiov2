import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A merge once dropped the `}` closing an @media block in index.css, which
// broke the production build (PostCSS "Unclosed block"). Catch it here first.
describe('src/index.css', () => {
  it('has balanced braces', () => {
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    for (const c of css) {
      if (c === '{') depth++;
      if (c === '}') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });
});
