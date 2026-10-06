import { api, fmt } from '../core.js';
import { createPlayerEngine } from '../player/index.js';

const NOTES = {
  trailer: 'Trailer only. CFLIX has no full-length stream for this title.',
  missing: 'No trailer for this title, so nothing plays here.',
  blocked: "This trailer can't be played on CFLIX, so nothing plays here.",
};
const MEDIA_CONTROLS = [
  '#btn-toggle',
  '#btn-bigplay',
  '#btn-rew',
  '#btn-fwd',
  '#btn-mute',
  '#vol',
  '#seek',
  '#btn-full',
];
const HIDE_AFTER_MS = 3000;
const RUNNING = new Set(['playing', 'buffering']);

const $ = (selector) => document.querySelector(selector);
// `hidden` reflects as a property only on HTMLElement. The transport icons are
// <svg>, where `el.hidden = true` is a silent expando: only the content
// attribute reaches CSS, and `.player [hidden]` is what hides them.
const setHidden = (el, hidden) =>
  hidden ? el.setAttribute('hidden', '') : el.removeAttribute('hidden');
const clock = (seconds) => fmt(Math.max(0, Math.floor(seconds)));

export default async function player() {
  const refRaw = sessionStorage.getItem('cflix_play_ref');
  if (!refRaw) {
    location.href = '/home';
    return;
  }
  sessionStorage.removeItem('cflix_play_ref');

  let ref;
  try {
    ref = JSON.parse(refRaw);
  } catch {
    location.href = '/home';
    return;
  }

  const els = {
    title: $('.player__title'),
    epnum: $('#epnum'),
    badge: $('#media-badge'),
    note: $('#media-note'),
    frame: $('.player__frame'),
    poster: $('.player__poster'),
    seek: $('#seek'),
    elapsed: $('#elapsed'),
    time: $('#time'),
    played: $('.player__scrub i'),
    buffer: $('.player__buffer'),
    volFill: $('.player__voltrack i'),
    vol: $('#vol'),
    toggle: $('#btn-toggle'),
    iconPlay: $('#btn-toggle [data-icon="play"]'),
    iconPause: $('#btn-toggle [data-icon="pause"]'),
    iconSound: $('#btn-mute [data-icon="sound"]'),
    iconMute: $('#btn-mute [data-icon="mute"]'),
    big: $('#btn-bigplay'),
    back: $('#btn-back'),
    rew: $('#btn-rew'),
    fwd: $('#btn-fwd'),
    mute: $('#btn-mute'),
    full: $('#btn-full'),
    finish: $('#btn-finish'),
    root: $('.player'),
    transport: $('.player__transport'),
    still: $('.player__still'),
  };

  const state = {
    itemId: null,
    parentId: null,
    player: null,
    ready: false,
    status: 'offline',
    current: 0,
    duration: 0,
    buffered: 0,
    volume: 100,
    muted: false,
    fullscreen: false,
  };

  let scrubbing = false;
  let played = 0;
  let postedAt = 0;
  let posted = false;
  let previous = null;
  let ticker = null;
  let hideAt = 0;
  let hideTimer = 0;

  const showNotice = (kind, badge) => {
    els.badge.textContent = badge;
    els.badge.hidden = false;
    els.badge.classList.toggle('player__badge--none', kind === 'missing');
    els.note.textContent = NOTES[kind];
  };

  const setControlsEnabled = (enabled) => {
    for (const selector of MEDIA_CONTROLS) {
      const el = $(selector);
      if (el) el.disabled = !enabled;
    }
  };

  const applyPoster = (url) => {
    if (!url) return;
    els.poster.hidden = false;
    els.poster.src = url;
    els.poster.onerror = () => {
      els.poster.hidden = true;
      els.poster.removeAttribute('src');
    };
  };

  const render = () => {
    const live = state.ready;
    const at = state.current;
    const total = state.duration;
    const running = isRunning();

    els.elapsed.textContent = clock(at);
    els.time.textContent = `${clock(at)} / ${clock(total)}`;
    els.played.style.width = total
      ? `${Math.min(100, (at / total) * 100)}%`
      : '0%';
    els.buffer.style.width = total
      ? `${Math.min(100, state.buffered * 100)}%`
      : '0%';
    els.seek.max = String(total || 1);
    if (!scrubbing) els.seek.value = String(Math.min(at, total || 1));
    els.seek.setAttribute('aria-valuetext', `${clock(at)} of ${clock(total)}`);

    els.toggle.disabled = !live;
    els.toggle.setAttribute('aria-label', running ? 'Pause' : 'Play');
    setHidden(els.iconPlay, running);
    setHidden(els.iconPause, !running);
    setHidden(els.big, !live || running);

    els.mute.setAttribute('aria-pressed', String(state.muted));
    setHidden(els.iconSound, state.muted);
    setHidden(els.iconMute, !state.muted);
    els.vol.value = String(state.volume);
    els.vol.setAttribute('aria-valuetext', `${state.volume}%`);
    els.volFill.style.width = state.muted ? '0%' : `${state.volume}%`;

    els.full.setAttribute('aria-pressed', String(state.fullscreen));
  };

  const reportPosition = (seconds) => {
    const value = Math.round(seconds);
    return api('/api/progress', {
      method: 'POST',
      body: { itemId: state.itemId, seconds: value },
    })
      .then(() => {
        posted = true;
        postedAt = played;
      })
      .catch(() => {});
  };

  const seek = (seconds) => {
    if (!state.player || !state.duration) return;
    // getDuration() hands back an integer until exact metadata lands, so a target
    // at "the end" can overshoot the real stream end, which YouTube answers by
    // ending the video in place instead of moving.
    const target = Math.min(
      Math.max(seconds, 0),
      Math.max(0, state.duration - 0.5),
    );
    state.player.seekTo(target, true);
    state.current = target;
    render();
  };

  const toggle = () => {
    if (!state.player) return;
    if (state.status === 'playing' || state.status === 'buffering') {
      state.player.pause();
    } else {
      state.player.play();
    }
  };

  const setVolume = (value) => {
    state.volume = Math.min(100, Math.max(0, Math.round(value)));
    if (!state.player) return;
    state.player.unMute();
    state.player.setVolume(state.volume);
    state.muted = false;
    render();
  };

  const toggleMute = () => {
    if (!state.player) return;
    if (state.muted) state.player.unMute();
    else state.player.mute();
    state.muted = !state.muted;
    render();
  };

  const toggleFullscreen = () => {
    const box = document.querySelector('.player');
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : (box.requestFullscreen?.() ?? box.webkitRequestFullscreen?.call(box));
    Promise.resolve(request).catch(() => {});
  };

  const isRunning = () => RUNNING.has(state.status);

  const transportKeyboardFocused = () => {
    const active = document.activeElement;
    if (!active || !els.transport.contains(active)) return false;
    try {
      return active.matches(':focus-visible');
    } catch {
      return false;
    }
  };

  const hideAllowed = () =>
    state.ready && isRunning() && !scrubbing && !transportKeyboardFocused();

  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = 0;
    els.root.classList.remove('is-idle');
    if (!hideAllowed()) return;
    hideTimer = setTimeout(
      () => {
        hideTimer = 0;
        if (!hideAllowed()) return;
        els.root.classList.add('is-idle');
      },
      Math.max(0, hideAt - performance.now()),
    );
  };

  const poke = () => {
    hideAt = performance.now() + HIDE_AFTER_MS;
    scheduleHide();
  };

  const onKeydown = (event) => {
    poke();
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!state.ready || event.repeat) return;
    const key = event.key?.toLowerCase();
    if (key === ' ') {
      const target = event.target;
      const tag = target?.tagName?.toLowerCase();
      // Space activates a focused control natively, so the page must stand
      // down there or a button toggles twice.
      if (
        tag === 'button' ||
        tag === 'input' ||
        tag === 'select' ||
        tag === 'textarea' ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      toggle();
      return;
    }
    if (key === 'f') toggleFullscreen();
    else if (key === 'm') toggleMute();
  };

  const tick = () => {
    if (typeof state.player?.getCurrentTime !== 'function') return;
    const time = state.player.getCurrentTime();
    const duration = state.player.getDuration();
    const fraction = state.player.getVideoLoadedFraction();
    if (Number.isFinite(time) && time >= 0) state.current = time;
    if (Number.isFinite(duration) && duration > 0) state.duration = duration;
    if (Number.isFinite(fraction)) state.buffered = fraction;

    const running = state.status === 'playing';
    if (running && previous !== null) {
      // A seek jumps the clock; counting that jump as watched time would post
      // progress the viewer never sat through.
      played += Math.min(Math.max(time - previous, 0), 2);
      if (!posted && time >= 1) reportPosition(time);
      else if (posted && played - postedAt >= 10) reportPosition(time);
    }
    previous = running ? time : null;
    render();
  };

  els.seek.addEventListener('pointerdown', (event) => {
    scrubbing = true;
    try {
      els.seek.setPointerCapture(event.pointerId);
    } catch {}
    scheduleHide();
  });
  window.addEventListener('pointerup', () => {
    scrubbing = false;
    poke();
  });
  els.seek.addEventListener('keydown', () => {
    scrubbing = true;
  });
  els.seek.addEventListener('keyup', () => {
    scrubbing = false;
    scheduleHide();
  });
  els.seek.addEventListener('blur', () => {
    scrubbing = false;
    scheduleHide();
  });
  els.seek.addEventListener('change', () => seek(Number(els.seek.value)));
  els.vol.addEventListener('input', () => setVolume(Number(els.vol.value)));
  els.toggle.addEventListener('click', toggle);
  els.big.addEventListener('click', toggle);
  els.rew.addEventListener('click', () => seek(state.current - 10));
  els.fwd.addEventListener('click', () => seek(state.current + 10));
  els.mute.addEventListener('click', toggleMute);
  els.full.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    state.fullscreen = !!document.fullscreenElement;
    render();
  });
  document.addEventListener('pointermove', poke);
  document.addEventListener('click', poke);
  document.addEventListener('keydown', onKeydown);
  els.transport.addEventListener('focusin', scheduleHide);
  els.transport.addEventListener('focusout', () => setTimeout(scheduleHide));
  els.still.addEventListener('click', toggle);

  const parentPromise =
    ref.kind === 'series'
      ? api(`/api/catalog/get?id=${encodeURIComponent(ref.id)}`).catch(
          () => null,
        )
      : null;

  let playback;
  try {
    playback = await api('/api/play', { method: 'POST', body: { ref } });
  } catch {
    location.href = '/home';
    return;
  }

  const item = playback.item;
  state.itemId = item.id;
  state.parentId = item.seriesId || (ref.kind === 'series' ? ref.id : null);

  els.title.textContent = item.title;
  document.title = `${item.title} · CFLIX`;
  if (item.seasonNumber != null && item.episodeNumber != null) {
    els.epnum.textContent = `S${item.seasonNumber}:E${item.episodeNumber}`;
    els.epnum.hidden = false;
  }

  let parent = null;
  if (!item.trailerYtId && state.parentId) {
    parent = parentPromise
      ? await parentPromise
      : await api(
          `/api/catalog/get?id=${encodeURIComponent(state.parentId)}`,
        ).catch(() => null);
  }

  applyPoster(
    item.backdropUrl ||
      item.stillUrl ||
      parent?.backdropUrl ||
      item.posterUrl ||
      parent?.posterUrl,
  );

  const trailer = item.trailerYtId || parent?.trailerYtId || null;
  const resume = Number(playback.resumeFromSeconds) || 0;

  els.back.addEventListener('click', async () => {
    if (state.player) await reportPosition(state.current);
    location.href = state.parentId
      ? `/title?id=${encodeURIComponent(state.parentId)}`
      : `/title?id=${encodeURIComponent(item.id)}`;
  });

  els.finish.addEventListener('click', async () => {
    clearInterval(ticker);
    await api('/api/progress', {
      method: 'POST',
      body: { itemId: item.id, seconds: 0 },
    }).catch(() => {});
    location.href = '/home';
  });

  if (!trailer) {
    state.duration = Number(item.durationSeconds) || 0;
    showNotice('missing', 'NO PREVIEW');
    setControlsEnabled(false);
    render();
    return;
  }

  showNotice('trailer', 'TRAILER');
  els.frame.hidden = false;

  const engine = createPlayerEngine({ trailerYtId: trailer });
  state.player = engine;

  engine.setEvents({
    onReady: (ready) => {
      state.ready = true;
      state.volume = ready.volume;
      state.muted = ready.muted;
      state.status = 'ready';
      if (Number.isFinite(ready.duration) && ready.duration > 0) {
        state.duration = ready.duration;
      }
      // The engine applies `resume` itself before it reports ready.
      setControlsEnabled(true);
      if (!ticker) ticker = setInterval(tick, 250);
      render();
      poke();
    },
    onStateChange: (stateName) => {
      state.status = stateName;
      render();
      scheduleHide();
    },
    onError: () => {
      state.ready = false;
      state.status = 'broken';
      showNotice('blocked', 'UNAVAILABLE');
      setControlsEnabled(false);
      render();
      scheduleHide();
    },
  });

  // Controls stay disabled until the engine reports ready. mount() resolves only
  // after onReady, so this must run before the await, never after it.
  setControlsEnabled(false);
  render();

  try {
    await engine.mount('yt-player', { videoId: trailer, resume });
  } catch {
    state.ready = false;
    state.status = 'broken';
    showNotice('blocked', 'UNAVAILABLE');
    setControlsEnabled(false);
    render();
  }
}
