export const ses = {
  get token() {
    return sessionStorage.getItem('cflix_token');
  },
  set token(v) {
    v
      ? sessionStorage.setItem('cflix_token', v)
      : sessionStorage.removeItem('cflix_token');
  },
  get profile() {
    try {
      return JSON.parse(sessionStorage.getItem('cflix_profile'));
    } catch {
      return null;
    }
  },
  set profile(v) {
    v
      ? sessionStorage.setItem('cflix_profile', JSON.stringify(v))
      : sessionStorage.removeItem('cflix_profile');
  },
};

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && ses.token) headers.authorization = `Bearer ${ses.token}`;
  if (ses.profile) headers['x-cflix-profile'] = ses.profile.id;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(data.error?.message || 'request failed'), {
      code: data.error?.code,
    });
  return data;
}

export function fillRow(id, items, short = false) {
  const el = document.getElementById(id);
  if (!el) return;
  const cards = items.map((item) => {
    // Built with DOM calls rather than an innerHTML template: the values are
    // provider metadata, and no attribute, text, or url() string context exists
    // here for one to escape from.
    const card = document.createElement('article');
    card.className = `card ${short ? 'card--short' : 'card--landscape'}`;
    card.dataset.id = item.id;
    card.style.cursor = 'pointer';

    const art = document.createElement('div');
    art.className = item.posterUrl
      ? 'card__art'
      : `card__art ph ph--${'abcdefgh'[Math.floor(Math.random() * 8)]}`;
    if (item.posterUrl) art.style.backgroundImage = `url("${item.posterUrl}")`;

    const title = document.createElement('div');
    title.className = 'card__title';
    title.textContent = item.title;

    card.append(art, title);
    card.onclick = () => {
      location.href = `/title?id=${encodeURIComponent(card.dataset.id)}`;
    };
    return card;
  });
  el.replaceChildren(...cards);
}

export async function startPlay(ref) {
  sessionStorage.setItem('cflix_play_ref', JSON.stringify(ref));
  location.href = '/watch';
}

export function fmt(s) {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
