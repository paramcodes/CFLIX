'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ContentRail, type ContentRailItem } from './ContentRail';
import { Skeleton } from '../ui/Skeleton';
import { fetchApi } from '../../lib/api';

export interface LazyRailProps {
  title: string;
  endpoint: string;
  shape?: 'portrait' | 'landscape';
  queryKey?: string;
  rootMargin?: string;
  className?: string;
}

export function LazyRail({
  title,
  endpoint,
  shape = 'portrait',
  queryKey,
  rootMargin = '400px 0px',
  className,
}: LazyRailProps) {
  const [shouldFetch, setShouldFetch] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shouldFetch) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldFetch(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }

    return () => observer.disconnect();
  }, [shouldFetch, rootMargin]);

  const { data, isLoading } = useQuery<ContentRailItem[]>({
    queryKey: [queryKey || endpoint],
    queryFn: async () => {
      const res = await fetchApi<{ items?: ContentRailItem[] }>(endpoint);
      return res.items || [];
    },
    enabled: shouldFetch,
    staleTime: 5 * 60 * 1000,
  });

  const isPortrait = shape === 'portrait';

  return (
    <div ref={sentinelRef} className={className}>
      {shouldFetch && !isLoading && data && data.length > 0 ? (
        <ContentRail title={title} items={data} shape={shape} />
      ) : (
        <section className="my-6 sm:my-8 px-4 sm:px-12">
          <h2 className="text-lg sm:text-2xl font-bold text-white mb-2 sm:mb-3">
            {title}
          </h2>
          <div className="flex gap-2 sm:gap-3 overflow-hidden py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton
                key={i}
                className={
                  isPortrait
                    ? 'w-[140px] sm:w-[180px] aspect-[2/3] flex-none'
                    : 'w-[240px] sm:w-[300px] aspect-[16/9] flex-none'
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
