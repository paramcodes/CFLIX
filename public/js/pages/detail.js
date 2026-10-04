import { api, startPlay } from '../core.js';

export default async function detail() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    location.href = '/home';
    return;
  }
  const item = await api(`/api/catalog/get?id=${id}`);
  document.querySelector('.detail__artwork span').textContent = item.title;
  document.querySelector('.detail__synopsis').textContent = item.synopsis;
  const meta = document.querySelector('.detail__metarow');
  meta.innerHTML =
    item.kind === 'series'
      ? `<span>${item.seasons.length} Seasons</span><span>${item.year}</span>`
      : `<span>${Math.round(item.durationSeconds / 60)}m</span><span>${item.year}</span>`;
  document.title = item.title;
  const eps = document.querySelector('#episodes');
  if (item.seasons) {
    eps.innerHTML = item.seasons
      .map(
        (s) =>
          `<h3>Season ${s.seasonNumber}</h3>` +
          s.episodes
            .map(
              (e) =>
                `<p class="episode-link" data-ep="${e.id}" style="cursor:pointer;padding:6px 0;border-bottom:1px solid #333">▶ ${e.episodeNumber}. ${e.title} · ${Math.round(e.durationSeconds / 60)}m</p>`,
            )
            .join(''),
      )
      .join('');
    for (const el of eps.querySelectorAll('.episode-link')) {
      el.onclick = () => startPlay({ kind: 'episode', id: el.dataset.ep });
    }
  }
  document.querySelector('#btn-play').onclick = () =>
    startPlay(
      item.kind === 'movie'
        ? { kind: 'movie', id: item.id }
        : { kind: 'series', id: item.id },
    );
}
