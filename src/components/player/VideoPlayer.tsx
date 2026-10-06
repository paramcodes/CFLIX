'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  ArrowLeft,
  CheckCircle,
} from 'lucide-react';
import {
  createPlayerEngine,
  type VideoPlayerEngine,
} from '../../../public/js/player/index.js';
import { fetchApi } from '../../lib/api';

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface VideoPlayerItem {
  id: string;
  title: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}

export interface VideoPlayerProps {
  item?: VideoPlayerItem | null;
  trailerYtId?: string | null;
  resumeSeconds?: number;
}

export function VideoPlayer({
  item,
  trailerYtId,
  resumeSeconds = 0,
}: VideoPlayerProps) {
  const router = useRouter();
  const playerRef = useRef<VideoPlayerEngine | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isIdle, setIsIdle] = useState(false);
  const [notice, setNotice] = useState(trailerYtId ? 'TRAILER' : 'NO PREVIEW');

  useEffect(() => {
    if (!trailerYtId) {
      setNotice('NO PREVIEW');
      return;
    }

    const engine = createPlayerEngine({ trailerYtId });
    playerRef.current = engine;

    engine.setEvents({
      onReady: (ready: {
        duration: number;
        volume: number;
        muted: boolean;
      }) => {
        setIsReady(true);
        setDuration(ready.duration);
        setVolume(ready.volume);
        setIsMuted(ready.muted);
        if (resumeSeconds > 0 && resumeSeconds < ready.duration) {
          engine.seekTo(resumeSeconds);
        }
      },
      onStateChange: (stateName: string) => {
        setIsPlaying(stateName === 'playing');
      },
      onError: () => {
        setIsReady(false);
        setNotice('UNAVAILABLE');
      },
    });

    engine
      .mount('video-mount-target', {
        videoId: trailerYtId,
        resume: resumeSeconds,
      })
      .catch(() => {
        setNotice('UNAVAILABLE');
      });

    const ticker = setInterval(() => {
      if (!engine) return;
      const t = engine.getCurrentTime();
      const d = engine.getDuration();
      const b = engine.getVideoLoadedFraction();
      if (Number.isFinite(t)) setCurrentTime(t);
      if (Number.isFinite(d) && d > 0) setDuration(d);
      if (Number.isFinite(b)) setBuffered(b);
    }, 250);

    return () => {
      clearInterval(ticker);
      engine.destroy();
    };
  }, [trailerYtId, resumeSeconds]);

  // Idle timer for hiding controls
  useEffect(() => {
    let timer: NodeJS.Timeout | number | undefined;
    const poke = () => {
      setIsIdle(false);
      clearTimeout(timer);
      if (isPlaying) {
        timer = setTimeout(() => setIsIdle(true), 3500);
      }
    };

    window.addEventListener('mousemove', poke);
    window.addEventListener('keydown', poke);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', poke);
      window.removeEventListener('keydown', poke);
    };
  }, [isPlaying]);

  const togglePlay = () => {
    if (!playerRef.current || !isReady) return;
    if (isPlaying) playerRef.current.pause();
    else playerRef.current.play();
  };

  const toggleMute = () => {
    if (!playerRef.current) return;
    if (isMuted) playerRef.current.unMute();
    else playerRef.current.mute();
    setIsMuted(!isMuted);
  };

  const handleSeek = (newTime: number) => {
    if (!playerRef.current) return;
    playerRef.current.seekTo(newTime);
    setCurrentTime(newTime);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  };

  const handleFinish = async () => {
    if (item?.id) {
      await fetchApi('/api/progress', {
        method: 'POST',
        body: { itemId: item.id, seconds: 0 },
      }).catch(() => {});
    }
    router.push('/');
  };

  return (
    <div
      ref={containerRef}
      className="relative w-screen h-screen bg-black overflow-hidden select-none"
    >
      {/* Video Target Container */}
      <div id="video-mount-target" className="absolute inset-0 w-full h-full" />

      {/* Notice Badge overlay */}
      <div className="absolute top-6 right-6 z-40 flex items-center gap-2">
        <span className="px-2.5 py-1 rounded bg-black/60 border border-white/20 text-white font-bold text-xs tracking-wider uppercase backdrop-blur">
          {notice}
        </span>
      </div>

      {/* Top Header Controls (Back & Title) */}
      <div
        className={`absolute top-0 left-0 right-0 z-40 p-6 bg-gradient-to-b from-black/80 to-transparent flex items-center gap-4 transition-opacity duration-300 ${
          isIdle ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="text-white hover:text-neutral-300 p-2 rounded-full hover:bg-white/10 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div>
          <h1 className="text-white font-bold text-lg sm:text-xl drop-shadow">
            {item?.title}
          </h1>
          {item?.seasonNumber != null && item?.episodeNumber != null ? (
            <p className="text-neutral-300 text-xs sm:text-sm">
              S{item.seasonNumber}:E{item.episodeNumber}
            </p>
          ) : null}
        </div>
      </div>

      {/* Bottom Transport Controls Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-40 px-6 pb-6 pt-16 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col gap-3 transition-opacity duration-300 ${
          isIdle ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        {/* Scrubber Bar */}
        <div className="relative w-full flex items-center group/scrub cursor-pointer">
          <input
            type="range"
            min={0}
            max={duration || 1}
            value={currentTime}
            onChange={(e) => handleSeek(Number(e.target.value))}
            className="w-full h-1.5 bg-white/30 rounded-lg appearance-none cursor-pointer accent-red-600 focus:outline-none"
          />
          {/* Buffer track */}
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 bg-white/20 rounded pointer-events-none"
            style={{ width: `${buffered * 100}%` }}
          />
        </div>

        {/* Buttons and Time Display */}
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-4 sm:gap-6">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!isReady}
              className="hover:scale-110 transition-transform disabled:opacity-40"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-7 h-7" />
              ) : (
                <Play className="w-7 h-7 fill-white" />
              )}
            </button>
            <button
              type="button"
              onClick={() => handleSeek(currentTime - 10)}
              className="hover:scale-110 transition-transform text-neutral-300 hover:text-white"
              aria-label="Rewind 10 seconds"
            >
              <RotateCcw className="w-6 h-6" />
            </button>
            <button
              type="button"
              onClick={() => handleSeek(currentTime + 10)}
              className="hover:scale-110 transition-transform text-neutral-300 hover:text-white"
              aria-label="Fast forward 10 seconds"
            >
              <RotateCw className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-2 group/vol">
              <button
                type="button"
                onClick={toggleMute}
                className="hover:scale-110 transition-transform text-neutral-300 hover:text-white"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? (
                  <VolumeX className="w-6 h-6 text-red-500" />
                ) : (
                  <Volume2 className="w-6 h-6" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setVolume(val);
                  if (playerRef.current) {
                    playerRef.current.setVolume(val);
                    if (isMuted && val > 0) {
                      playerRef.current.unMute();
                      setIsMuted(false);
                    }
                  }
                }}
                className="w-14 sm:w-20 h-1 accent-white cursor-pointer"
                aria-label="Volume slider"
              />
            </div>
            <span className="text-xs sm:text-sm font-medium text-neutral-300">
              {formatClock(currentTime)} / {formatClock(duration)}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleFinish}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-xs sm:text-sm font-medium transition-colors"
            >
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              Finish
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="hover:scale-110 transition-transform text-neutral-300 hover:text-white"
              aria-label="Toggle fullscreen"
            >
              <Maximize className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
