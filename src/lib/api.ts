/**
 * Client-side API fetch client for CFLIX.
 * Interacts with backend API routes and transparently attaches auth headers.
 */

export interface ActiveProfile {
  id: string;
  name: string;
  maturity?: string;
}

export interface FetchApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  token?: string | null;
  profileId?: string | null;
}

function getStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getActiveToken(): string | null {
  return getStorage('cflix_token');
}

export function getActiveProfile(): ActiveProfile | null {
  const raw = getStorage('cflix_profile');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'id' in parsed &&
      'name' in parsed
    ) {
      return {
        id: String(parsed.id),
        name: String(parsed.name),
        maturity: 'maturity' in parsed ? String(parsed.maturity) : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchApi<T = Record<string, unknown>>(
  path: string,
  options: FetchApiOptions = {},
): Promise<T> {
  const {
    method = 'GET',
    body,
    headers = {},
    token = getActiveToken(),
    profileId = getActiveProfile()?.id,
  } = options;

  const reqHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...headers,
  };

  if (token) reqHeaders.authorization = `Bearer ${token}`;
  if (profileId) reqHeaders['x-cflix-profile'] = profileId;

  const res = await fetch(path, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    let code = 'ERROR';

    if (data && typeof data === 'object' && 'error' in data) {
      const errObj = data.error;
      if (errObj && typeof errObj === 'object') {
        if ('message' in errObj && typeof errObj.message === 'string') {
          message = errObj.message;
        }
        if ('code' in errObj && typeof errObj.code === 'string') {
          code = errObj.code;
        }
      }
    }

    const error = new Error(message) as Error & {
      code: string;
      status: number;
    };
    error.code = code;
    error.status = res.status;
    throw error;
  }

  return data as T;
}
