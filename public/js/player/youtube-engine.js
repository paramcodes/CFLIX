import { VideoPlayerEngine } from './engine.js';

const YT_SCRIPT = 'https://www.youtube.com/iframe_api';
const YT_HOST = 'https://www.youtube-nocookie.com';

const YT_STATES = {
  '-1': 'ready',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'ready',
};

/**
 * Loads the YouTube Iframe API script asynchronously.
 * Idempotent: returns the existing API if already loaded.
 */
export function loadYouTubeApi() {
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

/**
 * YouTube Player Engine Adapter.
 * Encapsulates window.YT.Player iframe orchestration.
 */
export class YouTubePlayerEngine extends VideoPlayerEngine {
  constructor() {
    super();
    this.ytPlayer = null;
  }

  /**
   * @param {string | HTMLElement} target
   * @param {Object} options
   * @param {string} options.videoId
   * @param {number} [options.resume]
   */
  async mount(target, options) {
    const YT = await loadYouTubeApi();
    if (!YT) {
      const err = new Error('YouTube Iframe API unavailable');
      this.events.onError(err);
      throw err;
    }

    const containerId =
      typeof target === 'string'
        ? target
        : target.id || (target.id = 'yt-player-target');

    return new Promise((resolve) => {
      this.ytPlayer = new YT.Player(containerId, {
        videoId: options.videoId,
        host: YT_HOST,
        playerVars: {
          autoplay: 1,
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
            const frame = ready.getIframe?.();
            if (frame) {
              frame.tabIndex = -1;
              frame.title = 'Trailer player';
            }
            const duration = ready.getDuration();
            const validDuration =
              Number.isFinite(duration) && duration > 0 ? duration : 0;
            if (options.resume && options.resume < validDuration) {
              ready.seekTo(options.resume, true);
            }
            this.events.onReady({
              volume: ready.getVolume?.() ?? 100,
              muted: ready.isMuted?.() ?? false,
              duration: validDuration,
            });
            this.events.onStateChange('ready');
            resolve();
          },
          onStateChange: (event) => {
            const stateName = YT_STATES[event.data] || 'ready';
            this.events.onStateChange(stateName);
          },
          onError: (event) => {
            this.events.onError(event);
          },
        },
      });
    });
  }

  play() {
    this.ytPlayer?.playVideo?.();
  }

  playVideo() {
    this.play();
  }

  pause() {
    this.ytPlayer?.pauseVideo?.();
  }

  pauseVideo() {
    this.pause();
  }
  seekTo(seconds) {
    this.ytPlayer?.seekTo?.(seconds, true);
  }

  setVolume(pct) {
    this.ytPlayer?.unMute?.();
    this.ytPlayer?.setVolume?.(pct);
  }

  mute() {
    this.ytPlayer?.mute?.();
  }

  unMute() {
    this.ytPlayer?.unMute?.();
  }

  getCurrentTime() {
    return this.ytPlayer?.getCurrentTime?.() ?? 0;
  }

  getDuration() {
    return this.ytPlayer?.getDuration?.() ?? 0;
  }

  getVideoLoadedFraction() {
    return this.ytPlayer?.getVideoLoadedFraction?.() ?? 0;
  }

  destroy() {
    try {
      this.ytPlayer?.destroy?.();
    } catch {}
    this.ytPlayer = null;
  }
}
