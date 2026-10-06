import { VideoPlayerEngine } from './engine.js';

/**
 * Native HTML5 Video Player Engine Adapter.
 * Supports direct MP4, WebM, or browser-native HLS streams.
 */
export class Html5VideoEngine extends VideoPlayerEngine {
  constructor() {
    super();
    /** @type {HTMLVideoElement | null} */
    this.video = null;
    /** @type {HTMLElement | null} */
    this.container = null;
  }

  /**
   * @param {string | HTMLElement} target
   * @param {Object} options
   * @param {string} options.src
   * @param {number} [options.resume]
   */
  async mount(target, options) {
    const el =
      typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) throw new Error(`Mount target element not found: ${target}`);
    this.container = el;

    const video = document.createElement('video');
    video.src = options.src;
    video.autoplay = true;
    video.playsInline = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';

    video.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (options.resume && options.resume < duration) {
        video.currentTime = options.resume;
      }
      this.events.onReady({
        volume: Math.round(video.volume * 100),
        muted: video.muted,
        duration,
      });
      this.events.onStateChange('ready');
    });

    video.addEventListener('play', () => {
      this.events.onStateChange('playing');
    });

    video.addEventListener('pause', () => {
      this.events.onStateChange('paused');
    });

    video.addEventListener('waiting', () => {
      this.events.onStateChange('buffering');
    });

    video.addEventListener('ended', () => {
      this.events.onStateChange('ended');
    });

    video.addEventListener('error', () => {
      this.events.onError(video.error);
    });

    el.innerHTML = '';
    el.appendChild(video);
    this.video = video;
  }

  play() {
    this.video?.play().catch(() => {});
  }

  pause() {
    this.video?.pause();
  }

  seekTo(seconds) {
    if (!this.video) return;
    const max = Number.isFinite(this.video.duration) ? this.video.duration : 0;
    this.video.currentTime = Math.min(
      Math.max(seconds, 0),
      Math.max(0, max - 0.5),
    );
  }

  setVolume(pct) {
    if (!this.video) return;
    this.video.volume = Math.min(1, Math.max(0, pct / 100));
    this.video.muted = false;
  }

  mute() {
    if (!this.video) return;
    this.video.muted = true;
  }

  unMute() {
    if (!this.video) return;
    this.video.muted = false;
  }

  getCurrentTime() {
    return this.video ? this.video.currentTime : 0;
  }

  getDuration() {
    return this.video && Number.isFinite(this.video.duration)
      ? this.video.duration
      : 0;
  }

  getVideoLoadedFraction() {
    if (!this.video || !this.video.buffered.length || !this.video.duration) {
      return 0;
    }
    const end = this.video.buffered.end(this.video.buffered.length - 1);
    return Math.min(1, end / this.video.duration);
  }

  destroy() {
    if (this.video) {
      this.video.pause();
      this.video.src = '';
      this.video.remove();
      this.video = null;
    }
  }
}
