'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  MediaCard,
  type MediaCardProps,
} from '../../components/media/MediaCard';
import { Skeleton } from '../../components/ui/Skeleton';
import { fetchApi } from '../../lib/api';

const KINDS = [
  { id: '', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'series', label: 'Series' },
  { id: 'anime', label: 'Anime' },
];

const GENRES = [
  'action',
  'animation',
  'comedy',
  'crime',
  'drama',
  'horror',
  'sci-fi',
  'thriller',
];

function BrowseContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const q = searchParams.get('q') || '';
  const kind = searchParams.get('kind') || '';
  const genre = searchParams.get('genre') || '';

  const [selectedKind, setSelectedKind] = useState(kind);
  const [selectedGenre, setSelectedGenre] = useState(genre);

  useEffect(() => {
    setSelectedKind(kind);
    setSelectedGenre(genre);
  }, [kind, genre]);

  const updateFilters = (newKind: string, newGenre: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (newKind) params.set('kind', newKind);
    if (newGenre) params.set('genre', newGenre);
    router.push(`/browse?${params.toString()}`);
  };

  const { data: items, isLoading } = useQuery<MediaCardProps['item'][]>({
    queryKey: ['browse-grid', q, selectedKind, selectedGenre],
    queryFn: async () => {
      if (q) {
        const res = await fetchApi('/api/catalog/search', {
          method: 'POST',
          body: {
            text: q,
            kind: selectedKind || undefined,
            limit: 30,
          },
        });
        return (res.items || []) as MediaCardProps['item'][];
      }

      const params = new URLSearchParams();
      if (selectedKind) params.set('kind', selectedKind);
      if (selectedGenre) params.set('genre', selectedGenre);
      const res = await fetchApi(`/api/catalog/browse?${params.toString()}`);
      return (res.items || []) as MediaCardProps['item'][];
    },
  });

  return (
    <div className="pt-24 px-4 sm:px-12 pb-20">
      {/* Header and Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white">
            {q ? `Search results for “${q}”` : 'Explore Catalog'}
          </h1>
          <p className="text-neutral-400 text-xs sm:text-sm mt-1">
            Browse movies, series, and anime with instant filtering
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Kind Tabs */}
          <div className="flex bg-neutral-900 border border-neutral-800 rounded-lg p-1">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => updateFilters(k.id, selectedGenre)}
                className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                  selectedKind === k.id
                    ? 'bg-neutral-800 text-white shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>

          {/* Genre Dropdown */}
          <select
            value={selectedGenre}
            onChange={(e) => updateFilters(selectedKind, e.target.value)}
            className="bg-neutral-900 border border-neutral-800 text-white text-xs sm:text-sm rounded-lg px-3 py-2 focus:outline-none"
          >
            <option value="">All Genres</option>
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Media Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {Array.from({ length: 18 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] w-full rounded-md" />
          ))}
        </div>
      ) : items && items.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {items.map((item) => (
            <MediaCard
              key={item?.id}
              item={item}
              shape="portrait"
              className="w-full"
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 text-neutral-400">
          <p className="text-lg">No titles found matching your criteria.</p>
          <button
            type="button"
            onClick={() => updateFilters('', '')}
            className="mt-4 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white text-sm rounded transition-colors"
          >
            Reset Filters
          </button>
        </div>
      )}
    </div>
  );
}

export default function BrowsePage() {
  return (
    <Suspense
      fallback={
        <div className="pt-24 px-12 text-white">Loading catalog...</div>
      }
    >
      <BrowseContent />
    </Suspense>
  );
}
