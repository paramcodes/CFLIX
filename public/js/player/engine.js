/**
 * Video Player Engine Strategy Interface for CFLIX.
 *
 * Implements the Strategy Pattern for media playback. Decouples video transport
 * controls (scrubbing, volume, hotkeys, transport glyphs) from specific video
 * backends (YouTube Iframe API, native HTML5 <video>, HLS.js, Shaka Player).
 *
 * @typedef {'offline' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'broken'} PlaybackState
 *
 * @typedef {Object} EngineReadyPayload
 * @property {number} volume Current volume (0-100)
 * @property {boolean} muted Current mute status
 * @property {number} duration Media duration in seconds
 *
 * @typedef {Object} EngineEvents
 * @property {(payload: EngineReadyPayload) => void} onReady
 * @property {(state: PlaybackState) => void} onStateChange
 * @property {(err: Error | unknown) => void} onError
 */

export class VideoPlayerEngine {
  constructor() {
    /** @type {EngineEvents} */
    this.events = {
      onReady: () => {},
      onStateChange: () => {},
      onError: () => {},
    };
  }

  /**
   * Set callback event handlers.
   * @param {Partial<EngineEvents>} events
   */
  setEvents(events) {
    this.events = { ...this.events, ...events };
  }

  /**
   * Mount the video player into the specified DOM element.
   * @param {string | HTMLElement} _target
   * @param {Object} _options
   * @returns {Promise<void>}
   */
  async mount(_target, _options = {}) {
    throw new Error('mount() must be implemented by engine');
  }

  play() {
    throw new Error('play() must be implemented by engine');
  }

  pause() {
    throw new Error('pause() must be implemented by engine');
  }

  /** @param {number} _seconds */
  seekTo(_seconds) {
    throw new Error('seekTo() must be implemented by engine');
  }

  /** @param {number} _pct 0-100 */
  setVolume(_pct) {
    throw new Error('setVolume() must be implemented by engine');
  }

  mute() {
    throw new Error('mute() must be implemented by engine');
  }

  unMute() {
    throw new Error('unMute() must be implemented by engine');
  }

  /** @returns {number} Current playback time in seconds */
  getCurrentTime() {
    return 0;
  }

  /** @returns {number} Duration in seconds */
  getDuration() {
    return 0;
  }

  /** @returns {number} Fraction of video loaded (0.0 to 1.0) */
  getVideoLoadedFraction() {
    return 0;
  }

  destroy() {}
}
