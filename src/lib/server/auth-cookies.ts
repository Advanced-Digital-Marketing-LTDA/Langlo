import type { RequestEvent } from '@sveltejs/kit';

/**
 * Copy the framework's Set-Cookie headers onto the SvelteKit response so form
 * actions (progressive enhancement, no client JS) can drive sign-in/out while
 * the framework remains the single writer of cookie names and values.
 */
export function applyAuthCookies(
  event: RequestEvent,
  response: Response
): void {
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attributes] = header.split(';');
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    // The framework percent-encodes values at write; SvelteKit encodes again
    // at set(), so decode once to preserve the exact wire value.
    const rawValue = pair.slice(separator + 1).trim();
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      /* not percent-encoded; keep raw */
    }
    // SvelteKit defaults secure:true when unset; mirror the source instead.
    const options: Parameters<typeof event.cookies.set>[2] = {
      path: '/',
      secure: false
    };
    for (const attribute of attributes) {
      const [rawKey, rawValue = ''] = attribute.trim().split('=');
      const key = rawKey.toLowerCase();
      if (key === 'path') options.path = rawValue || '/';
      else if (key === 'max-age') options.maxAge = Number(rawValue);
      else if (key === 'expires') options.expires = new Date(rawValue);
      else if (key === 'httponly') options.httpOnly = true;
      else if (key === 'secure') options.secure = true;
      else if (key === 'samesite')
        options.sameSite = rawValue.toLowerCase() as 'lax' | 'strict' | 'none';
    }
    event.cookies.set(name, value, options);
  }
}
