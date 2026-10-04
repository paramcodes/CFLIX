import { api, fillRow, startPlay } from '../core.js';

const el = (id) => document.getElementById(id);

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const MATURITY_LABEL = { child: 'All Ages', teen: 'Teen', adult: 'Mature' };

const GRADIENTS = 'abcdefgh';

const gradientFor = (id) =>
  GRADIENTS[[...String(id)].reduce((n, c) => n + c.charCodeAt(0), 0) % 8];

/**
 * Every provider scores 0-10. The page reads it the way the real product does, as a 0-100 match,
 * so `8.4` shows as `84% Match` rather than a bare decimal.
 */
const matchPercent = (rating) =>
  rating == null ? null : Math.max(0, Math.min(100, Math.round(rating * 10)));

const runtime = (seconds) => {
  const mins = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
};

/**
 * Two real series shapes reach this page. A provider item carries a flat `episodes[]`; the
 * offline fixture carries `seasons[].episodes[]`. Both flatten to one Episode[] here so no
 * renderer has to ask which kind of item it holds.
 */
const episodeList = (item) => {
  if (Array.isArray(item.episodes) && item.episodes.length)
    return item.episodes;
  if (Array.isArray(item.seasons))
    return item.seasons.flatMap((s) => s.episodes || []);
  return [];
};

const seasonsOf = (episodes) => {
  const groups = new Map();
  for (const ep of episodes) {
    const n = Number(ep.seasonNumber) || 1;
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(ep);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, list]) => [
      number,
      list.sort((a, b) => a.episodeNumber - b.episodeNumber),
    ]);
};

const seasonCount = (item, groups) =>
  Number(item.seasonCount) > 0 ? Number(item.seasonCount) : groups.length;

const factsOf = (item) => {
  const rows = [];
  const genres = (item.genres || []).filter(Boolean);
  if (genres.length) rows.push(['Genres', genres.join(', ')]);
  const cast = (item.cast || []).filter(Boolean);
  if (cast.length) rows.push(['Starring', cast.join(', ')]);
  rows.push([
    'Source',
    item.source === 'seed'
      ? 'Offline fixture, not live catalog data'
      : `Metadata from ${item.provider || 'a catalog provider'}`,
  ]);
  return rows;
};

function renderMeta(item, groups) {
  const tokens = [];
  const match = matchPercent(item.rating);
  if (match != null) {
    tokens.push({
      text: `${match}% Match`,
      cls: 'detail__match',
      title: `${match}% match, from a rating of ${item.rating} out of 10`,
    });
  }
  if (item.year != null) tokens.push({ text: String(item.year) });
  if (item.kind === 'series') {
    const n = seasonCount(item, groups);
    tokens.push({ text: n === 1 ? '1 Season' : `${n} Seasons` });
  } else if (item.durationSeconds != null) {
    tokens.push({ text: runtime(item.durationSeconds) });
  }
  tokens.push({
    text: 'HD',
    cls: 'badge-quality',
    title: 'Playback quality is not catalog data; this app always plays HD',
  });
  const maturity = MATURITY_LABEL[item.maturity];
  if (maturity) tokens.push({ text: maturity, cls: 'badge-maturity' });

  el('detail-metarow').innerHTML = tokens
    .map(
      (t) =>
        `<span class="${t.cls || ''}"${t.title ? ` title="${esc(t.title)}"` : ''}>${esc(t.text)}</span>`,
    )
    .join(' <span class="detail__sep" aria-hidden="true">·</span> ');
}

function renderArtwork(item) {
  const heading = el('detail-heading');
  el('detail-title').textContent = item.title;
  const logo = el('detail-logo');
  if (!item.logoUrl) return;
  logo.addEventListener(
    'error',
    () => {
      logo.hidden = true;
      heading.classList.remove('detail__sr');
    },
    { once: true },
  );
  logo.src = item.logoUrl;
  logo.hidden = false;
  heading.classList.add('detail__sr');
}

function renderFacts(item) {
  el('detail-facts').innerHTML = factsOf(item)
    .map(([term, value]) => `<dt>${esc(term)}</dt><dd>${esc(value)}</dd>`)
    .join('');
}

/**
 * A `<img>` that fails still paints its broken-image glyph over whatever is behind it, so the
 * element has to go, not just its pixels. The gradient underneath is the fallback.
 */
function dropBrokenStills(root) {
  for (const img of root.querySelectorAll('.ep__still')) {
    if (img.complete && img.naturalWidth === 0) img.remove();
    else img.addEventListener('error', () => img.remove(), { once: true });
  }
}

function episodeRow(ep, seconds) {
  const duration = Number(ep.durationSeconds) || 0;
  const watched = Number(seconds) || 0;
  const partial = watched > 0 && (duration === 0 || watched < duration);
  const percent =
    duration > 0 ? Math.min(100, Math.round((watched / duration) * 100)) : 0;
  return `<a class="ep episode-link" href="/watch" data-ep="${esc(ep.id)}">
  <span class="ep__num">${esc(ep.episodeNumber)}</span>
  <span class="ep__thumb"><i class="ph ph--${gradientFor(ep.id)}"></i>${ep.stillUrl ? `<img class="ep__still" src="${esc(ep.stillUrl)}" alt="" />` : ''}</span>
  <span class="ep__body">
    <span class="ep__line"><span class="ep__name">${esc(ep.title || `Episode ${ep.episodeNumber}`)}</span><span class="ep__run">${duration ? runtime(duration) : ''}</span></span>
    ${ep.synopsis ? `<span class="ep__desc">${esc(ep.synopsis)}</span>` : ''}
    ${
      partial
        ? `<span class="ep__progress" aria-hidden="true"><i style="width:${percent}%"></i></span><span class="ep__resume">Resume · ${percent}% watched${duration ? ` · ${runtime(duration - watched)} left` : ''}</span>`
        : ''
    }
  </span>
</a>`;
}

function renderEpisodes(item, groups, progress) {
  const wrap = el('episodes-wrap');
  const picker = el('detail-seasons');
  if (!groups.length) {
    if (item.kind !== 'series') {
      wrap.hidden = true;
      return;
    }
    el('episodes').innerHTML =
      '<p class="detail__empty">This provider returned no episode list for this title.</p>';
    return;
  }

  const show = (number) => {
    const list = groups.find(([n]) => n === number)?.[1] || [];
    for (const b of picker.querySelectorAll('button'))
      b.setAttribute(
        'aria-pressed',
        String(Number(b.dataset.season) === number),
      );
    el('episodes').innerHTML =
      `<h2 class="detail__ephead">Season ${number}</h2>` +
      list.map((ep) => episodeRow(ep, progress.get(ep.id))).join('');
    dropBrokenStills(el('episodes'));
    for (const row of el('episodes').querySelectorAll('.episode-link')) {
      row.addEventListener('click', (ev) => {
        ev.preventDefault();
        startPlay({ kind: 'episode', id: row.dataset.ep });
      });
    }
  };

  picker.hidden = groups.length < 2;
  if (groups.length > 1) {
    picker.innerHTML = groups
      .map(
        ([number], i) =>
          `<button type="button" data-season="${number}" aria-pressed="${i === 0}">Season ${number}</button>`,
      )
      .join('');
    picker.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-season]');
      if (b) show(Number(b.dataset.season));
    });
  }
  show(groups[0][0]);
}

function renderRelated(items) {
  const rail = el('row-related');
  const empty = el('related-empty');
  const list = (items || []).filter((i) => i && i.id);
  if (list.length) {
    fillRow('row-related', list);
    return;
  }
  el('related-wrap').querySelector('.row__title').hidden = true;
  rail.hidden = true;
  empty.hidden = false;
  empty.textContent =
    'Nothing in the catalog shares a genre with this title right now.';
}

function wireActions(item) {
  el('btn-play').addEventListener('click', () =>
    startPlay({
      kind: item.kind === 'series' ? 'series' : 'movie',
      id: item.id,
    }),
  );
  const soon = el('detail-soon');
  for (const b of el('detail-actions').querySelectorAll('[data-soon]')) {
    b.addEventListener('click', () => {
      soon.textContent = `${b.dataset.soon} is not built yet. Play is the only working action on this page.`;
    });
  }
}

function fail(message) {
  for (const id of [
    'detail-artwork',
    'detail-meta',
    'detail-actions',
    'episodes-wrap',
  ])
    el(id).hidden = true;
  el('related-wrap').hidden = true;
  el('detail-synopsis').textContent = message;
}

export default async function detail() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    location.href = '/home';
    return;
  }

  let item;
  try {
    item = await api(`/api/catalog/get?id=${encodeURIComponent(id)}`);
  } catch {
    fail(
      'We could not load that title. It may have been removed from the catalog.',
    );
    return;
  }

  const [history, related] = await Promise.all([
    api('/api/history').catch(() => ({ items: [] })),
    api(`/api/catalog/related?id=${encodeURIComponent(id)}`).catch(() => ({
      items: [],
    })),
  ]);

  document.title = item.title;
  renderArtwork(item);
  const groups = seasonsOf(episodeList(item));
  renderMeta(item, groups);
  renderFacts(item);
  el('detail-synopsis').textContent = item.synopsis || '';
  el('detail-backdrop').style.setProperty(
    '--photo',
    item.backdropUrl ? `url("${item.backdropUrl}")` : 'none',
  );

  wireActions(item);
  renderEpisodes(
    item,
    groups,
    new Map((history.items || []).map((h) => [h.itemId, h.seconds])),
  );
  renderRelated(related.items);
}
