import { api, ses, fillRow } from '../core.js';

export default async function home() {
  if (!ses.profile) {
    location.href = '/profiles';
    return;
  }
  document.querySelector('#who').textContent =
    `Watching as ${ses.profile.name}`;
  const [movies, series, history] = await Promise.all([
    api('/api/catalog/browse?kind=movie'),
    api('/api/catalog/browse?kind=series'),
    api('/api/history'),
  ]);
  fillRow('row-movies', movies.items);
  fillRow('row-series', series.items);
  fillRow(
    'row-continue',
    history.items.map((h) => h.item).filter(Boolean),
    true,
  );
  document.querySelector('#btn-switch').onclick = () => {
    ses.profile = null;
    location.href = '/profiles';
  };
  document.querySelector('#search-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const q = document.querySelector('#search-input').value;
    const { items } = await api('/api/catalog/search', {
      method: 'POST',
      body: { text: q },
    });
    fillRow('row-results', items);
    document.querySelector('#row-results-wrap').style.display = 'block';
  };
}
