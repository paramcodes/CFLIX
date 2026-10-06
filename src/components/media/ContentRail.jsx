'use client';

import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaCard } from './MediaCard.jsx';
import { cn } from '../../lib/utils.js';

export function ContentRail({
  title,
  items = [],
  shape = 'portrait',
  ranked = false,
  className,
}) {
  const containerRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  if (!items || items.length === 0) return null;

  const checkScroll = () => {
    if (!containerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = containerRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
  };

  const scroll = (direction) => {
    if (!containerRef.current) return;
    const { clientWidth } = containerRef.current;
    const scrollAmount = clientWidth * 0.75;
    containerRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  return (
    <section className={cn('relative my-6 sm:my-8 group/rail', className)}>
      <h2 className="text-lg sm:text-2xl font-bold text-white px-4 sm:px-12 mb-2 sm:mb-3 flex items-center gap-2">
        {title}
      </h2>

      <div className="relative">
        {/* Left Scroll Button */}
        {canScrollLeft ? (
          <button
            type="button"
            onClick={() => scroll('left')}
            aria-label="Scroll left"
            className="absolute left-0 top-0 bottom-0 z-30 w-8 sm:w-12 bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover/rail:opacity-100 transition-opacity"
          >
            <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8" />
          </button>
        ) : null}

        {/* Horizontal Rail Container */}
        <div
          ref={containerRef}
          onScroll={checkScroll}
          className="flex gap-2 sm:gap-3 px-4 sm:px-12 overflow-x-auto no-scrollbar scroll-smooth py-2"
        >
          {items.map((entry, index) => {
            const item = entry.item || entry;
            const progressPct = entry.pct ?? null;
            return (
              <MediaCard
                key={item.id}
                item={item}
                shape={shape}
                rank={ranked ? index + 1 : null}
                progressPct={progressPct}
              />
            );
          })}
        </div>

        {/* Right Scroll Button */}
        {canScrollRight ? (
          <button
            type="button"
            onClick={() => scroll('right')}
            aria-label="Scroll right"
            className="absolute right-0 top-0 bottom-0 z-30 w-8 sm:w-12 bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover/rail:opacity-100 transition-opacity"
          >
            <ChevronRight className="w-6 h-6 sm:w-8 sm:h-8" />
          </button>
        ) : null}
      </div>
    </section>
  );
}
