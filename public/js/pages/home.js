import { api, ses } from '../core.js';

const MATURITY_LABEL = { child: 'TV-Y', teen: 'TV-14', adult: 'TV-MA' };
const GRADIENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const HERO_SLIDES = 5;
const HERO_POOL = 12;
const GENRE_ROWS = 2;
const GENRE_MIN_ITEMS = 4;
const SEARCH_PAGE = 12;
const TAIL_ROOT_MARGIN = '400px 0px';

const SHAPES = {
  trending: 'portrait',
  movies: 'landscape',
  series: 'portrait',
  anime: 'portrait',
  continue: 'landscape',
  results: 'landscape',
};

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** A URL safe to interpolate into an attribute. */
const safeUrl = (value) => {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('/')) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.href
      : null;
  } catch {
    return null;
  }
};

const gradientOf = (id) => {
  const seed = [...String(id)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return `ph ph--${GRADIENTS[seed % GRADIENTS.length]}`;
};

/**
 * An `<img>` over a gradient, because a provider image that 404s has no
 * `background-image` fallback: removing the img reveals the gradient.
 */
const picture = (url, className) =>
  `<div class="${className} ${gradientOf(url.id)}">${
    safeUrl(url.src)
      ? `<img src="${esc(safeUrl(url.src))}" alt="" onerror="this.remove()" />`
      : ''
  }</div>`;

const titleHref = (id) => `/title?id=${encodeURIComponent(id)}`;

const summarise = (text, max) => {
  const clean = String(text ?? '').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
};

const browse = (query = '') =>
  api(`/api/catalog/browse${query ? `?${query}` : ''}`).catch(() => ({
    items: [],
  }));

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const byRating = (a, b) => (b.rating ?? -1) - (a.rating ?? -1);

/* ------------------------------------------------------------------ hero */

const PLAY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor" stroke="none"/></svg>';
const INFO_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 10.5v6"/></svg>';
const CHEVRON_LEFT =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 4.5l-7.5 7.5 7.5 7.5"/></svg>';
const CHEVRON_RIGHT =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 4.5l7.5 7.5L9 19.5"/></svg>';

function badges(item) {
  const maturity = MATURITY_LABEL[item.maturity];
  const rating = Number.isFinite(item.rating) ? item.rating.toFixed(1) : null;
  return [
    maturity ? `<span class="badge-maturity">${maturity}</span>` : '',
    rating ? `<span class="badge-quality">${esc(rating)}</span>` : '',
    item.source === 'seed'
      ? '<span class="badge-pill">Offline catalog</span>'
      : '',
  ].join('');
}

function slideMarkup(item, index) {
  const logo = safeUrl(item.logoUrl);
  const href = titleHref(item.id);

  return `
    <article class="hero__slide${index === 0 ? ' is-active' : ''}" data-id="${esc(item.id)}" data-title="${esc(item.title)}" data-backdrop="${safeUrl(item.backdropUrl) ? 'yes' : 'no'}" data-logo="${logo ? 'yes' : 'no'}"${index === 0 ? '' : ' inert'}>
      ${picture({ id: item.id, src: item.backdropUrl }, 'hero__bg')}
      <div class="hero__inner">
        <div class="hero__kicker">
          <span class="tiny">${item.kind === 'series' ? 'SERIES' : 'FILM'}</span>
          ${badges(item)}
        </div>
        <div class="hero__titlewrap">
          ${logo ? `<img class="hero__logo" src="${esc(logo)}" alt="" onerror="this.remove()" />` : ''}
          <h2 class="hero__title">${esc(item.title)}</h2>
        </div>
        <p class="hero__synopsis">${esc(summarise(item.synopsis, 280))}</p>
        <div class="hero__actions">
          <a class="btn btn--play hero__play" href="${href}">${PLAY_ICON} Play</a>
          <a class="btn btn--info hero__more" href="${href}">${INFO_ICON} More Info</a>
        </div>
      </div>
    </article>`;
}

function mountHero(items) {
  const hero = document.getElementById('hero');
  const slides = items.slice(0, HERO_SLIDES);
  hero.innerHTML = `
    ${slides.map(slideMarkup).join('')}
    <button class="hero__nav hero__nav--prev" type="button" aria-label="Previous featured title" disabled>${CHEVRON_LEFT}</button>
    <button class="hero__nav hero__nav--next" type="button" aria-label="Next featured title">${CHEVRON_RIGHT}</button>
    <div class="hero__dots">${slides
      .map(
        (item, i) =>
          `<button class="hero__dot" type="button" aria-label="Show ${esc(item.title)}"${
            i === 0 ? ' aria-current="true"' : ''
          }></button>`,
      )
      .join('')}</div>`;

  const tracks = [...hero.querySelectorAll('.hero__slide')];
  const dots = [...hero.querySelectorAll('.hero__dot')];
  const prev = hero.querySelector('.hero__nav--prev');
  const next = hero.querySelector('.hero__nav--next');
  let index = 0;

  const show = (want) => {
    index = Math.max(0, Math.min(tracks.length - 1, want));
    tracks.forEach((slide, i) => {
      slide.classList.toggle('is-active', i === index);
      slide.toggleAttribute('inert', i !== index);
    });
    dots.forEach((dot, i) =>
      dot.setAttribute('aria-current', String(i === index)),
    );
    prev.disabled = index === 0;
    next.disabled = index === tracks.length - 1;
  };

  prev.onclick = () => show(index - 1);
  next.onclick = () => show(index + 1);
  dots.forEach((dot, i) => {
    dot.onclick = () => show(i);
  });
  show(0);
}

/** The best-rated titles that carry a backdrop, reshuffled on every load. */
const heroPool = (items) => {
  const withArt = items.filter((item) => safeUrl(item.backdropUrl));
  const pool = (withArt.length ? withArt : items)
    .sort(byRating)
    .slice(0, HERO_POOL);
  return shuffled(pool).slice(0, HERO_SLIDES);
};

/* ------------------------------------------------------------------ rails */

function card(item, { index, shape, rank, pct }) {
  const maturity = MATURITY_LABEL[item.maturity];
  const filled = pct > 0 ? `${pct.toFixed(1)}%` : null;

  return `<a class="card card--${shape}${rank ? ' card--rank' : ''}${filled ? ' card--progress' : ''}" href="${titleHref(item.id)}" data-id="${esc(item.id)}"${filled ? ` data-pct="${pct.toFixed(1)}"` : ''} style="--i:${index}">
    ${rank ? `<span class="card__num">${rank}</span>` : ''}
    ${picture({ id: item.id, src: item.posterUrl }, 'card__art')}
    ${maturity ? `<div class="card__badges"><span class="badge-maturity">${maturity}</span></div>` : ''}
    <span class="card__title">${esc(item.title)}</span>
    ${filled ? `<span class="card__progress"><i class="card__progress-fill" style="width:${filled}"></i></span>` : ''}
  </a>`;
}

function mount(section, shape, { hideWhenEmpty = true } = {}) {
  const rail = section.querySelector('.row__rail');
  const prev = section.querySelector('.rail__nav--prev');
  const next = section.querySelector('.rail__nav--next');
  const label = section.querySelector('.row__title')?.textContent.trim() ?? '';

  for (const [button, side] of [
    [prev, 'left'],
    [next, 'right'],
  ]) {
    button.setAttribute('aria-label', `Scroll ${label} ${side}`);
    button.onclick = () =>
      rail.scrollBy({ left: (side === 'left' ? -1 : 1) * rail.clientWidth });
  }

  const sync = () => {
    const max = rail.scrollWidth - rail.clientWidth;
    const atStart = rail.scrollLeft <= 1;
    const atEnd = rail.scrollLeft >= max - 1;
    prev.disabled = atStart;
    next.disabled = atEnd;
    rail.dataset.more =
      max <= 1 ? '' : atStart ? 'end' : atEnd ? 'start' : 'both';
  };
  rail.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(rail);

  let shown = 0;

  const paint = (entries, ranked) =>
    entries
      .map((entry, i) => {
        const { item, pct = null } = entry.item ? entry : { item: entry };
        const index = shown + i;
        return card(item, {
          index,
          shape,
          rank: ranked ? index + 1 : null,
          pct,
        });
      })
      .join('');

  return {
    /** `entries` are catalog items or `{ item, pct }` pairs from watch history. */
    fill(entries, { ranked = false } = {}) {
      shown = 0;
      rail.innerHTML = paint(entries, ranked);
      if (hideWhenEmpty) section.hidden = entries.length === 0;
      sync();
    },
    append(entries) {
      if (!entries.length) return;
      rail.insertAdjacentHTML('beforeend', paint(entries, false));
      shown += entries.length;
      sync();
    },
  };
}

/**
 * A sentinel under the rail that asks for the next page as it approaches the viewport. Only a
 * cursor-backed row gets one: `/api/catalog/browse` answers `{ items }` with no cursor and
 * ignores `skip`, so a browse rail has no second page to ask for.
 */
function tailLoader(section, run) {
  const sentinel = document.createElement('span');
  sentinel.className = 'row__tail';
  sentinel.setAttribute('aria-hidden', 'true');
  section.querySelector('.rail').append(sentinel);

  let inFlight = false;
  new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting || inFlight) return;
      inFlight = true;
      Promise.resolve(run()).finally(() => {
        inFlight = false;
      });
    },
    { rootMargin: TAIL_ROOT_MARGIN },
  ).observe(sentinel);
}

/* ------------------------------------------------------------------ rows */

function topGenres(items) {
  const tally = new Map();
  for (const item of items) {
    for (const raw of Array.isArray(item.genres) ? item.genres : []) {
      const genre = String(raw ?? '').trim();
      if (genre) tally.set(genre, (tally.get(genre) ?? 0) + 1);
    }
  }
  return [...tally.entries()]
    .filter(([, count]) => count >= GENRE_MIN_ITEMS)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, GENRE_ROWS)
    .map(([genre]) => genre);
}

function genreRow(container, genre, items) {
  const section = document
    .getElementById('tpl-genre-row')
    .content.firstElementChild.cloneNode(true);
  const id = `row-genre-${genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  section.dataset.row = id;
  section.dataset.genreRow = genre;
  section.querySelector('.row__title').textContent = genre;
  const rail = section.querySelector('.row__rail');
  rail.id = id;
  rail.setAttribute('aria-label', `${genre} titles`);
  container.append(section);
  mount(section, 'portrait').fill(items);
  return section;
}

/** A history row with no known runtime gets no bar rather than a made-up one. */
function resumeEntries(rows) {
  return rows
    .filter((row) => row.item)
    .map(({ item, seconds }) => {
      const total = Number(item.durationSeconds);
      return {
        item,
        pct:
          total > 0 ? Math.min(100, ((Number(seconds) || 0) / total) * 100) : 0,
      };
    });
}

/* ------------------------------------------------------------------ page */

export default async function home() {
  if (!ses.profile) {
    location.href = '/profiles';
    return;
  }
  document.querySelector('#who').textContent =
    `Watching as ${ses.profile.name}`;

  const entering = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.dataset.enter = 'true';
        entering.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -6% 0px' },
  );

  const rows = new Map(
    [...document.querySelectorAll('.row[data-row]')].map((section) => [
      section.dataset.row,
      mount(section, SHAPES[section.dataset.row] ?? 'landscape', {
        hideWhenEmpty: section.id !== 'row-results-wrap',
      }),
    ]),
  );
  for (const section of document.querySelectorAll('.row'))
    entering.observe(section);

  const nav = document.querySelector('.nav');
  new IntersectionObserver(([entry]) =>
    nav?.classList.toggle('is-raised', entry.boundingClientRect.bottom <= 0),
  ).observe(document.getElementById('hero'));

  const [mixed, movies, series, anime, history] = await Promise.all([
    browse(),
    browse('kind=movie'),
    browse('kind=series'),
    browse('kind=series&genre=Animation'),
    api('/api/history').catch(() => ({ items: [] })),
  ]);

  mountHero(heroPool(mixed.items));
  rows.get('trending').fill(mixed.items.slice(0, 10), { ranked: true });
  rows.get('movies').fill(movies.items);
  rows.get('series').fill(series.items);
  rows.get('anime').fill(anime.items);
  rows.get('continue').fill(resumeEntries(history.items));

  const container = document.getElementById('rows-genre');
  await Promise.all(
    topGenres(mixed.items).map(async (genre) => {
      const { items } = await browse(`genre=${encodeURIComponent(genre)}`);
      entering.observe(genreRow(container, genre, items));
    }),
  );

  const wrap = document.getElementById('row-results-wrap');
  const empty = wrap.querySelector('.row__empty');
  const browseLink = wrap.querySelector('.browse-link');
  const results = rows.get('results');
  let query = '';
  let cursor = null;
  let exhausted = true;

  const search = async (from) =>
    api('/api/catalog/search', {
      method: 'POST',
      body: {
        text: query,
        limit: SEARCH_PAGE,
        ...(from ? { cursor: from } : {}),
      },
    }).catch(() => ({ items: [], nextCursor: null }));

  document
    .querySelector('#search-form')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      query = document.querySelector('#search-input').value.trim();
      const { items, nextCursor } = await search(null);
      cursor = nextCursor;
      exhausted = !nextCursor;
      results.fill(items);
      wrap.hidden = false;
      empty.hidden = items.length > 0;
      browseLink.hidden = !query;
      browseLink.href = `/browse?q=${encodeURIComponent(query)}`;
      browseLink.textContent = `Browse all results for “${query}”`;
      wrap.dataset.enter = 'true';
      wrap.scrollIntoView({ block: 'nearest' });
    });

  tailLoader(wrap, async () => {
    if (exhausted) return;
    const { items, nextCursor } = await search(cursor);
    cursor = nextCursor;
    exhausted = !nextCursor;
    results.append(items);
  });

  document.querySelector('#btn-switch').onclick = () => {
    ses.profile = null;
    location.href = '/profiles';
  };
}
