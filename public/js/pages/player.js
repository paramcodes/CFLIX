import { api, fmt } from '../core.js';

export default async function player() {
  const refRaw = sessionStorage.getItem('cflix_play_ref');
  if (!refRaw) {
    location.href = '/home';
    return;
  }
  const playback = await api('/api/play', {
    method: 'POST',
    body: { ref: JSON.parse(refRaw) },
  });
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
    if (position % 10 === 0)
      api('/api/progress', {
        method: 'POST',
        body: { itemId: playback.item.id, seconds: position },
      }).catch(() => {});
  };
  setInterval(tick, 1000);
  document.querySelector('#btn-finish').onclick = async () => {
    await api('/api/progress', {
      method: 'POST',
      body: { itemId: playback.item.id, seconds: 0 },
    }).catch(() => {});
    location.href = '/home';
  };
}
