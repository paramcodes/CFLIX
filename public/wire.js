const ses = {
  get token() { return sessionStorage.getItem('cflix_token'); },
  set token(v) { v ? sessionStorage.setItem('cflix_token', v) : sessionStorage.removeItem('cflix_token'); },
  get profile() { try { return JSON.parse(sessionStorage.getItem('cflix_profile')); } catch { return null; } },
  set profile(v) { v ? sessionStorage.setItem('cflix_profile', JSON.stringify(v)) : sessionStorage.removeItem('cflix_profile'); },
};

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && ses.token) headers.authorization = `Bearer ${ses.token}`;
  if (ses.profile) headers['x-cflix-profile'] = ses.profile.id;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || 'request failed'), { code: data.error?.code });
  return data;
}

const pages = {
  'sign-in': async () => {
    const emailEl = document.querySelector('#in-email');
    const pwEl = document.querySelector('#in-password');
    const errEl = document.querySelector('#in-error');
    const btn = document.querySelector('#btn-signin');
    const become = document.querySelector('#btn-signup');
    btn.onclick = async () => {
      try {
        const { user, session } = await api('/api/auth/signin', { method: 'POST', auth: false, body: { email: emailEl.value, password: pwEl.value } });
        ses.token = session.token;
        ses.profile = null;
        location.href = '../profiles.html';
      } catch (e) { errEl.textContent = e.message; }
    };
    become.onclick = async () => {
      try {
        const { user, session } = await api('/api/auth/signup', { method: 'POST', auth: false, body: { email: emailEl.value, password: pwEl.value } });
        ses.token = session.token;
        ses.profile = null;
        location.href = '../profiles.html';
      } catch (e) { errEl.textContent = e.message; }
    };
    document.querySelector('#btn-google').onclick = async () => {
      const email = prompt('Google stub: email for idToken ("google:<email>")');
      if (!email) return;
      try {
        const { session } = await api('/api/auth/google', { method: 'POST', auth: false, body: { idToken: `google:${email}` } });
        ses.token = session.token;
        location.href = '../profiles.html';
      } catch (e) { errEl.textContent = e.message; }
    };
  },

  'profiles': async () => {
    const list = document.querySelector('#profile-list');
    const avatarStyle = (id) => {
      let h = 2166136261;
      for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      const hue = (h >>> 0) % 360;
      return `--tint-a:${hue};--tint-b:${(hue + 47) % 360}`;
    };
    async function load() {
      const { items } = await api('/api/profiles');
      list.innerHTML = items.map((p, i) =>
        `<button class="avatar-tile" data-id="${p.id}" data-name="${p.name}">
           <span class="avatar-tile__pic${i === 0 ? '' : ' avatar-tile__pic--tint'}" style="${i === 0 ? '' : avatarStyle(p.id)}"></span>
           <span>${p.name} · ${p.maturity}</span>
         </button>`).join('') +
        `<button class="avatar-tile" id="add-profile"><span class="avatar-tile__pic avatar-tile__pic--add">+</span><span>Add</span></button>`;
      for (const b of list.querySelectorAll('.avatar-tile[data-id]')) {
        b.onclick = () => {
          ses.profile = { id: b.dataset.id, name: b.dataset.name };
          location.href = 'screens/05-home-page.html';
        };
      }
      document.querySelector('#add-profile').onclick = () => openAddDialog();
    }
    const backdrop = document.querySelector('#dlg-add');
    const nameEl = document.querySelector('#dlg-name');
    const errEl = document.querySelector('#dlg-error');
    const seg = document.querySelector('#dlg-maturity');
    let maturity = 'adult';
    for (const b of seg.querySelectorAll('button')) {
      b.onclick = () => {
        maturity = b.dataset.m;
        for (const x of seg.querySelectorAll('button')) x.classList.toggle('is-active', x === b);
      };
    }
    function openAddDialog() {
      nameEl.value = '';
      errEl.textContent = '';
      maturity = 'adult';
      for (const x of seg.querySelectorAll('button')) x.classList.toggle('is-active', x.dataset.m === 'adult');
      backdrop.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add('is-open')));
      nameEl.focus();
    }
    function closeAddDialog() {
      backdrop.classList.remove('is-open');
      setTimeout(() => { backdrop.hidden = true; }, 200);
    }
    document.querySelector('#dlg-cancel').onclick = closeAddDialog;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeAddDialog(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backdrop.hidden) closeAddDialog(); });
    document.querySelector('#dlg-create').onclick = async () => {
      const name = nameEl.value.trim();
      if (!name) { errEl.textContent = 'Name is required.'; nameEl.focus(); return; }
      try {
        await api('/api/profiles', { method: 'POST', body: { name, maturity } });
        closeAddDialog();
        load();
      } catch (e) { errEl.textContent = e.message; }
    };
    nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.querySelector('#dlg-create').click(); });
    load().catch(() => { location.href = 'screens/02-sign-in.html'; });
  },

  'home': async () => {
    if (!ses.profile) { location.href = '../profiles.html'; return; }
    document.querySelector('#who').textContent = `Watching as ${ses.profile.name}`;
    const [movies, series, history] = await Promise.all([
      api('/api/catalog/browse?kind=movie'),
      api('/api/catalog/browse?kind=series'),
      api('/api/history'),
    ]);
    fillRow('row-movies', movies.items);
    fillRow('row-series', series.items);
    fillRow('row-continue', history.items.map((h) => h.item).filter(Boolean), true);
    document.querySelector('#btn-switch').onclick = () => { ses.profile = null; location.href = '../profiles.html'; };
    document.querySelector('#search-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const q = document.querySelector('#search-input').value;
      const { items } = await api('/api/catalog/search', { method: 'POST', body: { text: q } });
      fillRow('row-results', items);
      document.querySelector('#row-results-wrap').style.display = 'block';
    };
  },

  'detail': async () => {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) { location.href = '05-home-page.html'; return; }
    const item = await api(`/api/catalog/get?id=${id}`);
    document.querySelector('.detail__artwork span').textContent = item.title;
    document.querySelector('.detail__synopsis').textContent = item.synopsis;
    const meta = document.querySelector('.detail__metarow');
    meta.innerHTML = item.kind === 'series'
      ? `<span>${item.seasons.length} Seasons</span><span>${item.year}</span>`
      : `<span>${Math.round(item.durationSeconds / 60)}m</span><span>${item.year}</span>`;
    document.title = item.title;
    const eps = document.querySelector('#episodes');
    if (item.seasons) {
      eps.innerHTML = item.seasons.map((s) =>
        `<h3>Season ${s.seasonNumber}</h3>` + s.episodes.map((e) =>
          `<p class="episode-link" data-ep="${e.id}" style="cursor:pointer;padding:6px 0;border-bottom:1px solid #333">▶ ${e.episodeNumber}. ${e.title} · ${Math.round(e.durationSeconds/60)}m</p>`).join('')).join('');
      for (const el of eps.querySelectorAll('.episode-link')) {
        el.onclick = () => startPlay({ kind: 'episode', id: el.dataset.ep });
      }
    }
    document.querySelector('#btn-play').onclick = () =>
      startPlay(item.kind === 'movie' ? { kind: 'movie', id: item.id } : { kind: 'series', id: item.id });
  },

  'player': async () => {
    const refRaw = sessionStorage.getItem('cflix_play_ref');
    if (!refRaw) { location.href = '05-home-page.html'; return; }
    const playback = await api('/api/play', { method: 'POST', body: { ref: JSON.parse(refRaw) } });
    sessionStorage.removeItem('cflix_play_ref');
    document.querySelector('.player__title').textContent = playback.item.title;
    let position = playback.resumeFromSeconds || 0;
    const duration = playback.item.durationSeconds || 3600;
    const elapsedEl = document.querySelector('.player__elapsed');
    const scrubEl = document.querySelector('.player__scrub i');
    const tick = () => {
      position += 1;
      elapsedEl.textContent = fmt(position);
      scrubEl.style.width = `${Math.min(100, (position / duration) * 100)}%`;
      if (position % 10 === 0) api('/api/progress', { method: 'POST', body: { itemId: playback.item.id, seconds: position } }).catch(() => {});
    };
    setInterval(tick, 1000);
    document.querySelector('#btn-finish').onclick = async () => {
      await api('/api/progress', { method: 'POST', body: { itemId: playback.item.id, seconds: 0 } }).catch(() => {});
      location.href = '05-home-page.html';
    };
  },
};

function fillRow(id, items, short = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = items.map((item) => `
    <article class="card ${short ? 'card--short' : 'card--landscape'}" data-id="${item.id}" style="cursor:pointer">
      <div class="card__art${item.posterUrl ? '' : ` ph ph--${'abcdefgh'[Math.floor(Math.random() * 8)]}`}"${item.posterUrl ? ` style="background-image:url('${item.posterUrl}')"` : ''}></div>
      <div class="card__title">${item.title}</div>
    </article>`).join('');
  for (const c of el.children) {
    c.onclick = () => { location.href = `09-title-detail.html?id=${c.dataset.id}`; };
  }
}

async function startPlay(ref) {
  sessionStorage.setItem('cflix_play_ref', JSON.stringify(ref));
  location.href = '10-player-scroll.html';
}

function fmt(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const page = document.body.dataset.page;
if (page && pages[page]) pages[page]();
