export interface Link {
  code: string;
  shortUrl: string;
  url: string;
  note: string | null;
  clicks: number;
  sparkline?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface DayCount {
  date: string;
  clicks: number;
}

export interface AccountStats {
  days: number;
  totalLinks: number;
  totalClicks: number;
  clicksInRange: number;
  clicksByDay: DayCount[];
  topLinks: { code: string; url: string; clicks: number }[];
}

export interface LinkStats {
  code: string;
  days: number;
  totalClicks: number;
  clicksInRange: number;
  clicksByDay: DayCount[];
  topReferrers: { referrer: string; clicks: number }[];
}

export interface ApiKeyInfo {
  id: number;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !location.pathname.startsWith('/login')) {
    location.href = '/login';
    throw new ApiError(401, 'unauthorized', 'Signed out');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  me: () => request<{ authenticated: boolean; domain: string; appUrl: string }>('GET', '/api/me'),
  login: (password: string) => request<{ ok: boolean }>('POST', '/login', { password }),
  logout: () => request<{ ok: boolean }>('POST', '/logout', {}),
  stats: (days: number) => request<AccountStats>('GET', `/api/stats?days=${days}`),
  links: (search = '') =>
    request<{ items: Link[]; total: number }>('GET', `/api/links?limit=200${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  createLink: (url: string, code?: string, note?: string) =>
    request<Link>('POST', '/api/links', { url, ...(code ? { code } : {}), ...(note ? { note } : {}) }),
  getLink: (code: string) => request<Link>('GET', `/api/links/${encodeURIComponent(code)}`),
  updateLink: (code: string, patch: { url?: string; note?: string }) =>
    request<Link>('PATCH', `/api/links/${encodeURIComponent(code)}`, patch),
  deleteLink: (code: string) => request<void>('DELETE', `/api/links/${encodeURIComponent(code)}`),
  linkStats: (code: string, days: number) =>
    request<LinkStats>('GET', `/api/links/${encodeURIComponent(code)}/stats?days=${days}`),
  keys: () => request<{ items: ApiKeyInfo[] }>('GET', '/api/keys'),
  createKey: (name: string) => request<{ id: number; name: string; prefix: string; key: string }>('POST', '/api/keys', { name }),
  deleteKey: (id: number) => request<void>('DELETE', `/api/keys/${id}`),
};
