// Thin client mirroring AccountSession / ViewingSession over the JSON API.

const state = {
  token: localStorage.getItem('cflix_token'),
  account: null,
  profile: null,
};

const $ = (id) => document.getElementById(id);

function show(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.remove('on');
  $(id).classList.add('on');
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && state.token) headers.authorization = `Bearer ${state.token}`;
  if (state.profile) headers['x-cflix-profile'] = state.profile.id;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || 'request failed');
  return data;
}

function setToken(token) {
  state.token = token;
  if (token) localStorage.setItem('cflix_token', token);
  else localStorage.removeItem('cflix_token');
}

async function afterAuth(account, session) {
  state.account = account;
  setToken(session.token);
  state.profile = null;
  await loadProfiles();
  show('view-profiles');
}

async function loadProfiles() {
  const { items } = await api('/api/profiles');
  $('profile-list').innerHTML = items.map((p) =>
    `<button class="btn btn--ghost" data-id="${p.id}" data-name="${p.name}">${p.name} (${p.maturity})</button>`).join('');
  for (const b of $('profile-list').querySelectorAll('button')) {
    b.onclick = async () => {
      state.profile = { id: b.dataset.id, name: b.dataset.name };
      $('who').textContent = `Watching as ${b.dataset.name}`;
      await loadHome();
      show('view-home');
    };
  }
}

async function loadHome() {
  const movies = await api('/api/catalog/browse?kind=movie');
  const series = await api('/api/catalog/browse?kind=series');
  $('row-movies').innerHTML = movies.items.map(tile).join('');
  $('row-series').innerHTML = series.items.map(tile).join('');
  wireTiles();
  $('search-results').innerHTML = '';
}

function tile(item) {
  const year = item.year;
  return `<div class="tile" data-kind="${item.kind}" data-id="${item.id}" style="background:linear-gradient(160deg,#123a5c,#060b14)">${item.title} · ${year}</div>`;
}

function wireTiles() {
  for (const t of document.querySelectorAll('.tile')) {
    t.onclick = async () => {
      const item = await api(`/api/catalog/get?id=${t.dataset.id}`);
      state.detail = item;
      $('detail-title').textContent = item.title;
      $('detail-synopsis').textContent = item.synopsis;
      $('detail-episodes').innerHTML = item.seasons
        ? item.seasons.map((s) => `<h3>Season ${s.seasonNumber}</h3>` +
            s.episodes.map((e) => `<p data-ep="${e.id}" style="cursor:pointer">▶ ${e.episodeNumber}. ${e.title} (${Math.round(e.durationSeconds/60)}m)</p>`).join('')).join('')
        : '';
      for (const e of $('detail-episodes').querySelectorAll('[data-ep]')) {
        e.onclick = () => playEpisode(e.dataset.ep);
      }
      show('view-detail');
    };
  }
}

async function playItem(ref) {
  const playback = await api('/api/play', { method: 'POST', body: { ref } });
  state.playback = playback;
  state.position = playback.resumeFromSeconds;
  $('player-title').textContent = playback.item.title || playback.item.name;
  $('player-info').textContent = playback.item.kind === 'episode' ? `S${playback.item.seasonNumber} E${playback.item.episodeNumber}` : playback.item.kind;
  $('player-resume').textContent = playback.resumeFromSeconds;
  show('view-player');
  startHeartbeat(playback.item);
}

async function playEpisode(episodeId) {
  return playItem({ kind: 'episode', id: episodeId });
}

function startHeartbeat(item) {
  clearInterval(state.timer);
  state.timer = setInterval(async () => {
    state.position = (state.position || 0) + 10;
    await api('/api/progress', { method: 'POST', body: { itemId: item.id, seconds: state.position } });
  }, 10_000);
}

$('btn-signin').onclick = async () => {
  try {
    const { user, session } = await api('/api/auth/signin', { method: 'POST', auth: false, body: { email: $('auth-email').value, password: $('auth-password').value } });
    afterAuth(user, session);
  } catch (e) { $('auth-error').textContent = e.message; }
};

$('btn-signup').onclick = async () => {
  try {
    const { user, session } = await api('/api/auth/signup', { method: 'POST', auth: false, body: { email: $('auth-email').value, password: $('auth-password').value } });
    afterAuth(user, session);
  } catch (e) { $('auth-error').textContent = e.message; }
};

$('btn-google').onclick = async () => {
  const email = prompt('Google stub: enter email for the idToken ("google:<email>")');
  if (!email) return;
  try {
    const { user, session } = await api('/api/auth/google', { method: 'POST', auth: false, body: { idToken: `google:${email}` } });
    afterAuth(user, session);
  } catch (e) { $('auth-error').textContent = e.message; }
};

$('btn-add-profile').onclick = async () => {
  await api('/api/profiles', { method: 'POST', body: { name: $('new-profile-name').value, maturity: $('new-profile-maturity').value } });
  $('new-profile-name').value = '';
  loadProfiles();
};

$('btn-play').onclick = () => {
  const ref = state.detail.kind === 'movie' ? { kind: 'movie', id: state.detail.id } : { kind: 'series', id: state.detail.id };
  playItem(ref);
};

$('btn-finish').onclick = async () => {
  await api('/api/progress', { method: 'POST', body: { itemId: state.playback.item.id, seconds: 0 } });
  clearInterval(state.timer);
  show('view-home');
};

$('btn-exit-player').onclick = () => { clearInterval(state.timer); show('view-home'); };
$('btn-back').onclick = () => show('view-home');
$('btn-switch').onclick = async () => { state.profile = null; await loadProfiles(); show('view-profiles'); };
$('btn-logout-1').onclick = $('btn-logout-2').onclick = async () => {
  try { await api('/api/auth/signout', { method: 'POST' }); } catch {}
  setToken(null); state.profile = null; show('view-auth');
};

$('btn-search').onclick = async () => {
  const { items } = await api('/api/catalog/search', { method: 'POST', body: { text: $('search').value } });
  $('search-results').innerHTML = `<h2 style="padding:0 4%">Results</h2><div class="row__rail">${items.map(tile).join('')}</div>`;
  wireTiles();
};

// Boot: Netflix-style. Token may restore the account, but always land on the profile picker.
if (state.token) {
  api('/api/profiles')
    .then(({ items }) => { state.account = { items }; show('view-profiles'); return loadProfiles(); })
    .catch(() => { setToken(null); show('view-auth'); });
}
