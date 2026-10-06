'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '../../lib/utils.js';

const GRADIENTS = [
  'from-red-900 to-black',
  'from-blue-900 to-black',
  'from-purple-900 to-black',
  'from-emerald-900 to-black',
  'from-amber-900 to-black',
  'from-indigo-900 to-black',
  'from-rose-900 to-black',
  'from-teal-900 to-black',
];

function gradientFor(id) {
  const seed = [...String(id || '0')].reduce(
    (sum, ch) => sum + ch.charCodeAt(0),
    0,
  );
  return GRADIENTS[seed % GRADIENTS.length];
}

export function MediaCard({
  item,
  shape = 'portrait',
  rank = null,
  progressPct = null,
  className,
}) {
  if (!item) return null;

  const isPortrait = shape === 'portrait';
  const imageUrl = isPortrait
    ? item.posterUrl || item.backdropUrl
    : item.backdropUrl || item.stillUrl || item.posterUrl;

  return (
    <Link
      href={`/title?id=${encodeURIComponent(item.id)}`}
      className={cn(
        'group relative flex-none block rounded-md overflow-hidden bg-neutral-900 transition-all duration-300 transform-gpu hover:scale-105 hover:z-20 hover:shadow-2xl hover:shadow-black/80',
        isPortrait
          ? 'w-[140px] sm:w-[180px] aspect-[2/3]'
          : 'w-[240px] sm:w-[300px] aspect-[16/9]',
        className,
      )}
    >
      {/* Background Image / Placeholder Gradient */}
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-br',
          gradientFor(item.id),
        )}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item.title}
            loading="lazy"
            className="w-full h-full object-cover transition-opacity duration-300 group-hover:opacity-90"
            onError={(e) => {
              // Hide image on 404 to reveal the fallback gradient
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : null}
      </div>

      {/* Top 10 Rank Number if specified */}
      {rank ? (
        <span className="absolute bottom-1 -left-2 text-6xl sm:text-7xl font-extrabold text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.9)] stroke-black pointer-events-none select-none opacity-90">
          {rank}
        </span>
      ) : null}

      {/* Watch Progress Bar */}
      {progressPct != null ? (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20 z-10">
          <div
            className="h-full bg-red-600 transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
          />
        </div>
      ) : null}

      {/* Title & Metadata Overlay (appears on hover) */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2 sm:p-3">
        <h3 className="text-white font-semibold text-xs sm:text-sm line-clamp-1 drop-shadow">
          {item.title}
        </h3>
        <div className="flex items-center gap-1.5 mt-1 text-[10px] sm:text-xs text-neutral-300">
          {item.year ? <span>{item.year}</span> : null}
          {item.maturity ? (
            <span className="px-1 py-0.5 border border-neutral-600 rounded text-[9px] uppercase">
              {item.maturity}
            </span>
          ) : null}
          {item.rating ? (
            <span className="text-emerald-400 font-medium">
              ★ {item.rating.toFixed(1)}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
