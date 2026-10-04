import { api, fmt } from '../core.js';

const YT_SCRIPT = 'https://www.youtube.com/iframe_api';
const YT_HOST = 'https://www.youtube-nocookie.com';
const NOTES = {
  trailer: 'Trailer only. CFLIX has no full-length stream for this title.',
  missing: 'No trailer for this title, so nothing plays here.',
  blocked: "This trailer can't be played on CFLIX, so nothing plays here.",
};
const YT_STATES = {
  '-1': 'ready',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'ready',
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

const $ = (selector) => document.querySelector(selector);
const clock = (seconds) => fmt(Math.max(0, Math.floor(seconds)));

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    const settle = () => resolve(window.YT?.Player ? window.YT : null);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      settle();
    };
    const script = document.createElement('script');
    script.src = YT_SCRIPT;
    script.onerror = settle;
    document.head.appendChild(script);
    setTimeout(settle, 15000);
  });
}

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
  let clocking = false;

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
    const running = state.status === 'playing' || state.status === 'buffering';

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
    els.iconPlay.hidden = running;
    els.iconPause.hidden = !running;
    els.big.hidden = !live || running;

    els.mute.setAttribute('aria-pressed', String(state.muted));
    els.iconSound.hidden = state.muted;
    els.iconMute.hidden = !state.muted;
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
    const target = Math.min(Math.max(seconds, 0), state.duration);
    state.player.seekTo(target, true);
    state.current = target;
    render();
  };

  const toggle = () => {
    if (!state.player) return;
    if (state.status === 'playing' || state.status === 'buffering') {
      state.player.pauseVideo();
    } else {
      state.player.playVideo();
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

  els.seek.addEventListener('pointerdown', () => {
    scrubbing = true;
  });
  window.addEventListener('pointerup', () => {
    scrubbing = false;
  });
  els.seek.addEventListener('keydown', () => {
    scrubbing = true;
  });
  els.seek.addEventListener('keyup', () => {
    scrubbing = false;
  });
  els.seek.addEventListener('blur', () => {
    scrubbing = false;
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

  const ytPromise = loadYouTubeApi();
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
  const YT = await ytPromise;
  if (!YT) {
    showNotice('blocked', 'UNAVAILABLE');
    setControlsEnabled(false);
    render();
    return;
  }

  els.frame.hidden = false;
  state.player = new YT.Player('yt-player', {
    videoId: trailer,
    host: YT_HOST,
    playerVars: {
      autoplay: 1,
      mute: 1,
      playsinline: 1,
      enablejsapi: 1,
      origin: location.origin,
      controls: 0,
      disablekb: 1,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
    },
    events: {
      onReady: (event) => {
        const ready = event.target;
        state.ready = true;
        state.volume = ready.getVolume();
        state.muted = ready.isMuted();
        state.status = 'ready';
        const duration = ready.getDuration();
        if (Number.isFinite(duration) && duration > 0)
          state.duration = duration;
        if (resume > 0 && resume < state.duration) ready.seekTo(resume, true);
        setControlsEnabled(true);
        if (!clocking) {
          clocking = true;
          setInterval(tick, 250);
        }
        render();
      },
      onStateChange: (event) => {
        state.status = YT_STATES[event.data] || 'ready';
        render();
      },
      onError: () => {
        state.ready = false;
        state.status = 'broken';
        showNotice('blocked', 'UNAVAILABLE');
        setControlsEnabled(false);
        render();
      },
    },
  });

  setControlsEnabled(false);
  render();
}
