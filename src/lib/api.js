/**
 * Client-side API fetch client for CFLIX.
 * Interacts with backend API routes and transparently attaches auth headers.
 */

function getStorage(key) {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getActiveToken() {
  return getStorage('cflix_token');
}

export function getActiveProfile() {
  const raw = getStorage('cflix_profile');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function fetchApi(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    token = getActiveToken(),
    profileId = getActiveProfile()?.id,
  } = options;

  const reqHeaders = {
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

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(
      data.error?.message || `Request failed with status ${res.status}`,
    );
    error.code = data.error?.code || 'ERROR';
    error.status = res.status;
    throw error;
  }

  return data;
}
