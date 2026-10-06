'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { EpisodeList } from '../../components/media/EpisodeList.jsx';
import { ContentRail } from '../../components/media/ContentRail.jsx';
import { fetchApi } from '../../lib/api.js';

function TitleDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');

  const {
    data: item,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['title', id],
    queryFn: async () => {
      if (!id) throw new Error('No title id provided');
      return fetchApi(`/api/catalog/get?id=${encodeURIComponent(id)}`);
    },
    enabled: !!id,
  });

  const { data: relatedData } = useQuery({
    queryKey: ['related', id],
    queryFn: async () => {
      if (!id) return [];
      const res = await fetchApi(
        `/api/catalog/related?id=${encodeURIComponent(id)}`,
      ).catch(() => ({ items: [] }));
      return res.items || [];
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        Loading title...
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-white">
        <h1 className="text-2xl font-bold mb-2">Title Not Found</h1>
        <p className="text-neutral-400 text-sm mb-4">
          This title may be blocked by your maturity level or does not exist.
        </p>
        <Link
          href="/"
          className="px-4 py-2 bg-neutral-800 rounded text-sm hover:bg-neutral-700"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  const backdrop = item.backdropUrl || item.posterUrl;
  const isSeries = item.kind === 'series';

  return (
    <div className="pb-20">
      {/* Hero Backdrop Banner */}
      <div className="relative w-full h-[50vh] sm:h-[65vh] flex items-end">
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
          <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#141414]/90 via-[#141414]/30 to-transparent" />
        </div>

        <div className="relative z-10 px-4 sm:px-12 pb-8 sm:pb-12 max-w-3xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold tracking-widest uppercase text-red-600">
              {isSeries ? 'Series' : 'Movie'}
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
            {item.year ? (
              <span className="text-xs text-neutral-400 font-medium">
                {item.year}
              </span>
            ) : null}
          </div>

          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight drop-shadow mb-3">
            {item.title}
          </h1>

          <p className="text-sm sm:text-base text-neutral-300 line-clamp-3 mb-6">
            {item.synopsis}
          </p>

          <Link
            href={`/watch?id=${encodeURIComponent(item.id)}`}
            className="inline-flex items-center gap-2 px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-lg hover:shadow-red-900/30 transition-all"
          >
            <Play className="w-5 h-5 fill-white" />
            Play
          </Link>
        </div>
      </div>

      {/* Series Episodes List */}
      {isSeries && item.episodes ? (
        <EpisodeList seriesId={item.id} episodes={item.episodes} />
      ) : null}

      {/* Related Titles Recommendations Rail */}
      {relatedData && relatedData.length > 0 ? (
        <ContentRail
          title="More Like This"
          items={relatedData}
          shape="portrait"
          className="mt-8"
        />
      ) : null}
    </div>
  );
}

export default function TitleDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen pt-24 px-12 text-white">Loading...</div>
      }
    >
      <TitleDetailContent />
    </Suspense>
  );
}
