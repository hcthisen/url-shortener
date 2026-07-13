// Single source of truth for path segments that can never be short codes.
// Used both by the router and by custom-alias validation.
export const RESERVED_PATHS = new Set([
  'api',
  'dashboard',
  'login',
  'logout',
  'docs',
  'openapi.json',
  'llms.txt',
  'assets',
  'static',
  'vendor',
  'healthz',
  'favicon.ico',
  'favicon.svg',
  'robots.txt',
]);

export function isReserved(segment: string): boolean {
  return RESERVED_PATHS.has(segment.toLowerCase());
}
