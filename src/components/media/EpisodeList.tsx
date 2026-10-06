'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Play } from 'lucide-react';

export interface EpisodeItem {
  id: string;
  title: string;
  episodeNumber?: number;
  seasonNumber?: number;
  durationSeconds?: number | null;
  synopsis?: string | null;
  stillUrl?: string | null;
}

export interface EpisodeListProps {
  seriesId?: string;
  _seriesId?: string;
  episodes?: EpisodeItem[];
}

export function EpisodeList({ _seriesId, episodes = [] }: EpisodeListProps) {
  const [selectedSeason, setSelectedSeason] = useState(1);

  if (!episodes || episodes.length === 0) return null;

  // Group episodes by season
  const seasonsMap = new Map<number, EpisodeItem[]>();
  for (const ep of episodes) {
    const s = ep.seasonNumber || 1;
    if (!seasonsMap.has(s)) seasonsMap.set(s, []);
    seasonsMap.get(s)!.push(ep);
  }

  const seasonNumbers = [...seasonsMap.keys()].sort((a, b) => a - b);
  const currentEpisodes = seasonsMap.get(selectedSeason) || [];

  return (
    <section className="my-8 px-4 sm:px-12 max-w-5xl">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-4 mb-4">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Episodes</h2>
        {seasonNumbers.length > 1 ? (
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(Number(e.target.value))}
            className="bg-neutral-800 text-white text-sm rounded px-3 py-1.5 border border-neutral-700 focus:outline-none"
          >
            {seasonNumbers.map((s) => (
              <option key={s} value={s}>
                Season {s}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="space-y-3">
        {currentEpisodes.map((ep) => (
          <Link
            key={ep.id}
            href={`/watch?id=${encodeURIComponent(ep.id)}`}
            className="group flex gap-4 p-3 rounded-lg hover:bg-neutral-800/60 transition-colors border border-transparent hover:border-neutral-700/50"
          >
            {/* Episode Still / Thumbnail */}
            <div className="relative w-32 sm:w-44 aspect-video flex-none rounded overflow-hidden bg-neutral-900">
              {ep.stillUrl ? (
                <img
                  src={ep.stillUrl}
                  alt={ep.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="w-full h-full bg-neutral-800 flex items-center justify-center text-xs text-neutral-500">
                  No preview
                </div>
              )}
              <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                <Play className="w-8 h-8 text-white opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all drop-shadow" />
              </div>
            </div>

            {/* Episode Information */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-bold text-sm sm:text-base text-white group-hover:text-red-500 transition-colors">
                  {ep.episodeNumber}. {ep.title}
                </span>
                {ep.durationSeconds ? (
                  <span className="text-xs text-neutral-400">
                    {Math.round(ep.durationSeconds / 60)}m
                  </span>
                ) : null}
              </div>
              {ep.synopsis ? (
                <p className="text-xs sm:text-sm text-neutral-400 line-clamp-2">
                  {ep.synopsis}
                </p>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
