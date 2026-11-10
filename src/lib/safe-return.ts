/**
 * A same-app path to go back to after a flow (e.g. the onboarding wizard),
 * from an untrusted query parameter. Anything that could leave the app falls
 * back to `fallback`: absolute or protocol-relative URLs, backslashes (browsers
 * read `/\evil.example` as `//evil.example`) and control characters.
 */
export function safeReturn(path: string | null | undefined, origin: string, fallback = '/dashboard'): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return fallback;
  try {
    const url = new URL(path, origin);
    if (url.origin !== new URL(origin).origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
