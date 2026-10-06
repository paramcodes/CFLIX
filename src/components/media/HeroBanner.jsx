'use client';

import React from 'react';
import Link from 'next/link';
import { Play, Info } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export function HeroBanner({ item, className }) {
  if (!item) return null;

  const backdrop = item.backdropUrl || item.posterUrl;
  const href = `/title?id=${encodeURIComponent(item.id)}`;

  return (
    <div
      className={cn(
        'relative w-full h-[55vh] sm:h-[75vh] min-h-[420px] max-h-[800px] flex items-end',
        className,
      )}
    >
      {/* Background Backdrop Image with Gradients */}
      <div className="absolute inset-0 overflow-hidden">
        {backdrop ? (
          <img
            src={backdrop}
            alt={item.title}
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-r from-red-950 via-neutral-900 to-black" />
        )}
        {/* Multi-stage vignette gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#141414]/90 via-[#141414]/30 to-transparent" />
      </div>

      {/* Hero Content Information */}
      <div className="relative z-10 px-4 sm:px-12 pb-12 sm:pb-20 max-w-2xl">
        <div className="flex items-center gap-2 mb-2 sm:mb-3">
          <span className="text-xs sm:text-sm font-bold tracking-widest uppercase text-red-600">
            {item.kind === 'series' ? 'Series' : 'Film'}
          </span>
          {item.maturity ? (
            <span className="px-1.5 py-0.5 border border-white/40 rounded text-[10px] font-semibold text-white/90">
              {item.maturity.toUpperCase()}
            </span>
          ) : null}
          {item.rating ? (
            <span className="text-xs font-semibold text-emerald-400">
              ★ {item.rating.toFixed(1)}
            </span>
          ) : null}
        </div>

        {/* Title / Wordmark */}
        {item.logoUrl ? (
          <img
            src={item.logoUrl}
            alt={item.title}
            className="max-h-20 sm:max-h-28 object-contain mb-3 drop-shadow-md"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight drop-shadow-lg mb-3">
            {item.title}
          </h1>
        )}

        {/* Synopsis */}
        <p className="text-sm sm:text-base text-neutral-300 line-clamp-3 mb-6 drop-shadow">
          {item.synopsis}
        </p>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <Link
            href={href}
            className="flex items-center gap-2 px-6 py-2.5 sm:px-8 sm:py-3 bg-white text-black font-semibold rounded hover:bg-white/90 transition-colors shadow-lg"
          >
            <Play className="w-5 h-5 fill-black" />
            Play
          </Link>
          <Link
            href={href}
            className="flex items-center gap-2 px-5 py-2.5 sm:px-7 sm:py-3 bg-white/20 hover:bg-white/30 text-white font-semibold rounded backdrop-blur transition-colors"
          >
            <Info className="w-5 h-5" />
            More Info
          </Link>
        </div>
      </div>
    </div>
  );
}
