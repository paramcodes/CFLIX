import { VideoPlayerEngine } from './engine.js';
import { YouTubePlayerEngine, loadYouTubeApi } from './youtube-engine.js';
import { Html5VideoEngine } from './html5-engine.js';

export {
  VideoPlayerEngine,
  YouTubePlayerEngine,
  Html5VideoEngine,
  loadYouTubeApi,
};

/**
 * Factory for creating the appropriate VideoPlayerEngine based on the media source.
 *
 * @param {Object} mediaSource
 * @param {string} [mediaSource.trailerYtId]
 * @param {string} [mediaSource.videoUrl]
 * @param {string} [mediaSource.manifestUrl]
 * @param {'youtube' | 'html5' | 'hls'} [mediaSource.type]
 * @returns {VideoPlayerEngine}
 */
export function createPlayerEngine(mediaSource = {}) {
  if (
    mediaSource.type === 'html5' ||
    mediaSource.videoUrl ||
    mediaSource.manifestUrl
  ) {
    return new Html5VideoEngine();
  }

  // Default to YouTube engine for trailer playback
  return new YouTubePlayerEngine();
}
