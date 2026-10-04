import { api, ses } from '../core.js';

const PAGE_SIZE = 12;
const DEBOUNCE_MS = 250;

/** One list feeds the tab strip, the URL parser and the request, so a kind cannot mean two things. */
const KINDS = [
  { id: '', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'series', label: 'Series' },
  { id: 'anime', label: 'Anime' },
];

/**
 * `GENRE_VOCABULARY` from `server/src/providers/maturity.js`, restated because the server owns that
 * table and serves it to no one. A genre added there has to be added here or the select and the
 * filter disagree.
 */
const GENRES = [
  'animation',
  'children',
  'family',
  'kids',
  'adult',
  'crime',
  'espionage',
  'horror',
  'thriller',
  'war',
].sort();

const MATURITY_LABEL = { child: 'G', teen: 'PG-13', adult: 'R' };

/**
 * Every status the catalog API can actually produce, measured against a running server. Anything
 * else, including a `fetch` that never reached the server, is an upstream failure.
 */
const FAILURE_KIND = {
  UNAUTHORIZED: 'auth',
  SESSION_EXPIRED: 'auth',
  NOT_FOUND: 'profile',
};

const TITLE_CASE = (slug) => slug.charAt(0).toUpperCase() + slug.slice(1);

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The same title must always get the same placeholder gradient, so a reload does not reshuffle. */
const gradient = (id) => {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 'abcdefgh'[h % 8];
};

/* ------------------------------------------------------------------ url <-> state */

function readState(search) {
  const p = new URLSearchParams(search);
  const kind = p.get('kind') ?? '';
  const genre = (p.get('genre') ?? '').toLowerCase();
  return {
    q: (p.get('q') ?? '').trim(),
    kind: KINDS.some((k) => k.id === kind) ? kind : '',
    genre: GENRES.includes(genre) ? genre : '',
  };
}

/** Fixed key order, so an unchanged state serialises identically and writes no history entry. */
function writeState({ q, kind, genre }) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (kind) p.set('kind', kind);
  if (genre) p.set('genre', genre);
  return p.toString();
}

/* ------------------------------------------------------------------ request */

/**
 * Anime is the one kind with no browse path. `GET /api/catalog/browse` has no anime branch and
 * routes it to the active provider, and an empty query is answered by the offline fixture before
 * Kitsu is ever asked, so an empty Anime tab gets no request rather than six titles that are not
 * anime.
 */
function plan(state, cursor) {
  if (state.kind === 'anime' && !state.q) return null;
  if (state.q) {
    return {
      method: 'POST',
      path: '/api/catalog/search',
      body: {
        text: state.q,
        kind: state.kind || undefined,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      },
    };
  }
  const p = new URLSearchParams();
  if (state.kind) p.set('kind', state.kind);
  if (state.genre) p.set('genre', state.genre);
  return { method: 'GET', path: `/api/catalog/browse?${p}` };
}

/**
 * The genre is re-applied on the client because `search` has no genre parameter at all and `browse`
 * falls back to the unfiltered fixture for any genre its provider cannot resolve.
 */
const inGenre = (item, genre) =>
  !genre ||
  (Array.isArray(item.genres) ? item.genres : []).some(
    (g) => String(g).toLowerCase() === genre,
  );

/* ------------------------------------------------------------------ render */

function card(item) {
  const art = `<div class="card__art ph ph--${gradient(item.id)}">${
    item.posterUrl
      ? `<img alt="" src="${esc(item.posterUrl)}" onerror="this.remove()" />`
      : ''
  }</div>`;
  const badges = [
    item.maturity
      ? `<span class="badge-maturity">${esc(MATURITY_LABEL[item.maturity] ?? item.maturity)}</span>`
      : '',
    item.year ? `<span class="badge-quality">${esc(item.year)}</span>` : '',
    item.source === 'seed' ? '<span class="badge-quality">Sample</span>' : '',
  ].join('');
  return `<a class="card card--portrait browse__card" href="/title?id=${encodeURIComponent(item.id)}" data-kind="${esc(item.kind ?? '')}" title="${esc(item.title)}">
    ${art}
    ${badges ? `<div class="card__badges">${badges}</div>` : ''}
    <div class="card__title">${esc(item.title)}</div>
  </a>`;
}

export default async function browse() {
  if (!ses.profile) {
    location.href = '/profiles';
    return;
  }

  const el = {
    form: document.querySelector('#browse-form'),
    q: document.querySelector('#browse-q'),
    genre: document.querySelector('#browse-genre'),
    tabs: document.querySelector('#browse-tabs'),
    count: document.querySelector('#browse-count'),
    note: document.querySelector('#browse-note'),
    panel: document.querySelector('#browse-panel'),
    grid: document.querySelector('#browse-grid'),
    empty: document.querySelector('#browse-empty'),
    error: document.querySelector('#browse-error'),
    retry: document.querySelector('#browse-retry'),
    errorLink: document.querySelector('#browse-error-link'),
    more: document.querySelector('#browse-more'),
  };

  document.querySelector('#browse-who').textContent = ses.profile.name;

  el.genre.innerHTML =
    '<option value="">All genres</option>' +
    GENRES.map((g) => `<option value="${g}">${TITLE_CASE(g)}</option>`).join(
      '',
    );

  el.tabs.innerHTML = KINDS.map(
    (k, i) =>
      `<button class="browse__tab" type="button" role="tab" id="browse-tab-${k.id || 'all'}" data-kind="${k.id}" data-index="${i}" aria-controls="browse-panel">${k.label}</button>`,
  ).join('');

  let state = readState(location.search);
  let view = { status: 'loading', rows: [], nextCursor: null, failure: null };
  let requestSeq = 0;
  let debounce;

  const scope = () =>
    `${state.q ? ` for “${state.q}”` : ''}${
      state.genre ? ` in ${TITLE_CASE(state.genre)}` : ''
    }`;

  function emptyCopy() {
    if (state.kind === 'anime' && !state.q)
      return 'The anime catalog is search-only. Type a title to search it.';
    if (state.q) return `Nothing in the catalog matches “${state.q}”.`;
    if (state.genre)
      return `No title in the catalog is tagged ${TITLE_CASE(state.genre)}.`;
    return 'The catalog returned no titles.';
  }

  /**
   * `add` is the delta, never the whole set: appending every row again would double the grid and
   * refetch every poster, and `reset` is false only when the rows already in the DOM are the ones
   * being kept.
   */
  function render({ reset, add, skeletons }) {
    const status =
      view.status === 'ready' && !view.rows.length ? 'empty' : view.status;

    el.panel.setAttribute('aria-busy', String(view.status === 'loading'));
    for (const s of el.grid.querySelectorAll('.browse__skeleton')) s.remove();
    if (reset) el.grid.innerHTML = '';
    if (add.length)
      el.grid.insertAdjacentHTML('beforeend', add.map(card).join(''));
    if (skeletons)
      el.grid.insertAdjacentHTML(
        'beforeend',
        '<div class="browse__skeleton" aria-hidden="true"></div>'.repeat(
          PAGE_SIZE,
        ),
      );

    el.count.textContent =
      view.status === 'loading' && !view.rows.length
        ? state.q
          ? `Searching for “${state.q}”…`
          : 'Loading the catalog…'
        : `${view.rows.length} ${view.rows.length === 1 ? 'title' : 'titles'}${scope()}`;

    const offline = view.rows.some((i) => i.source === 'seed');
    el.note.hidden = !offline;
    el.note.textContent = offline
      ? 'Offline sample data. These titles come from the bundled fixture, not the live catalog.'
      : '';

    el.empty.hidden = status !== 'empty';
    el.empty.querySelector('[data-empty-copy]').textContent = emptyCopy();

    el.error.hidden = status !== 'error';
    if (status === 'error') {
      const kind = view.failure.kind;
      el.error.querySelector('[data-error-title]').textContent =
        kind === 'auth'
          ? 'Sign in again'
          : kind === 'profile'
            ? 'Pick a profile'
            : 'The catalog could not be reached';
      el.error.querySelector('[data-error-copy]').textContent =
        view.failure.message;
      el.retry.hidden = kind !== 'upstream';
      el.errorLink.hidden = kind === 'upstream';
      el.errorLink.href = kind === 'auth' ? '/signin' : '/profiles';
    }

    el.more.hidden = view.nextCursor === null;
    el.more.disabled = view.status === 'loading';
  }

  async function load(cursor = null) {
    const seq = ++requestSeq;
    const appending = cursor !== null;
    const request = plan(state, cursor);

    if (!request) {
      view = { status: 'ready', rows: [], nextCursor: null, failure: null };
      render({ reset: true, add: [], skeletons: false });
      return;
    }

    view = appending
      ? { ...view, status: 'loading', failure: null }
      : { status: 'loading', rows: [], nextCursor: null, failure: null };
    render({ reset: !appending, add: [], skeletons: true });

    let fresh;
    try {
      const data = await api(request.path, {
        method: request.method,
        body: request.body,
      });
      if (seq !== requestSeq) return;
      fresh = (Array.isArray(data.items) ? data.items : []).filter((item) =>
        inGenre(item, state.genre),
      );
      view = {
        status: 'ready',
        rows: appending ? [...view.rows, ...fresh] : fresh,
        nextCursor: data.nextCursor ?? null,
        failure: null,
      };
    } catch (err) {
      if (seq !== requestSeq) return;
      fresh = [];
      view = {
        status: 'error',
        rows: appending ? view.rows : [],
        nextCursor: appending ? view.nextCursor : null,
        failure: {
          kind: FAILURE_KIND[err.code] ?? 'upstream',
          message: err.message,
        },
      };
    }
    render({
      reset: !appending,
      add: fresh,
      skeletons: false,
    });
  }

  function syncControls() {
    if (el.q.value !== state.q) el.q.value = state.q;
    el.genre.value = state.genre;
    for (const tab of el.tabs.children) {
      const on = tab.dataset.kind === state.kind;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    el.panel.setAttribute(
      'aria-labelledby',
      `browse-tab-${state.kind || 'all'}`,
    );
  }

  /** Typing replaces the entry it is editing; a committed change adds one so back has somewhere to go. */
  function commit(next, mode) {
    const trimmed = { ...state, ...next, q: (next.q ?? state.q).trim() };
    const search = writeState(trimmed);
    if (search === writeState(state)) return;
    state = trimmed;
    history[mode === 'push' ? 'pushState' : 'replaceState'](
      null,
      '',
      search ? `/browse?${search}` : '/browse',
    );
    syncControls();
    load();
  }

  el.q.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      commit({ q: el.q.value }, 'replace');
    }, DEBOUNCE_MS);
  });

  el.form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    clearTimeout(debounce);
    commit({ q: el.q.value }, 'push');
  });

  el.genre.addEventListener('change', () => {
    commit({ genre: el.genre.value }, 'push');
  });

  el.tabs.addEventListener('click', (ev) => {
    const tab = ev.target.closest('[data-kind]');
    if (tab) commit({ kind: tab.dataset.kind }, 'push');
  });

  el.tabs.addEventListener('keydown', (ev) => {
    const from = Number(ev.target.dataset.index);
    if (!Number.isInteger(from)) return;
    let to = null;
    if (ev.key === 'ArrowRight') to = (from + 1) % KINDS.length;
    else if (ev.key === 'ArrowLeft')
      to = (from + KINDS.length - 1) % KINDS.length;
    else if (ev.key === 'Home') to = 0;
    else if (ev.key === 'End') to = KINDS.length - 1;
    if (to === null) return;
    ev.preventDefault();
    commit({ kind: KINDS[to].id }, 'push');
    el.tabs.children[to].focus();
  });

  el.more.addEventListener('click', () => load(view.nextCursor));
  el.retry.addEventListener('click', () => load(view.nextCursor));

  addEventListener('popstate', () => {
    clearTimeout(debounce);
    state = readState(location.search);
    syncControls();
    load();
  });

  syncControls();
  load();
}
