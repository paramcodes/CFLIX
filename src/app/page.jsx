'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { HeroBanner } from '../components/media/HeroBanner.jsx';
import { ContentRail } from '../components/media/ContentRail.jsx';
import { LazyRail } from '../components/media/LazyRail.jsx';
import { fetchApi, getActiveProfile, getActiveToken } from '../lib/api.js';

export default function HomePage() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const token = getActiveToken();
    const activeProf = getActiveProfile();

    if (!token) {
      router.push('/signin');
      return;
    }
    if (!activeProf) {
      router.push('/profiles');
      return;
    }
    setProfile(activeProf);
  }, [router]);

  // Above-the-fold queries: Only fetch trending and history initially!
  const { data: mixedData } = useQuery({
    queryKey: ['browse-trending'],
    queryFn: async () => {
      const res = await fetchApi('/api/catalog/browse');
      return res.items || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: historyData } = useQuery({
    queryKey: ['history'],
    queryFn: async () => {
      const res = await fetchApi('/api/history').catch(() => ({ items: [] }));
      return res.items || [];
    },
    staleTime: 60 * 1000,
  });

  const trendingItems = mixedData || [];
  const heroItem = trendingItems[0] || null;

  return (
    <div className="pb-16">
      {/* 1. Above-The-Fold: Hero Banner */}
      <HeroBanner item={heroItem} />

      {/* 2. Above-The-Fold: Trending Top 10 Rail */}
      {trendingItems.length > 0 ? (
        <ContentRail
          title="Top 10 in CFLIX Today"
          items={trendingItems.slice(0, 10)}
          shape="portrait"
          ranked
          className="-mt-16 sm:-mt-24 z-20 relative"
        />
      ) : null}

      {/* 3. Continue Watching (if user has watch progress) */}
      {historyData && historyData.length > 0 ? (
        <ContentRail
          title={`Continue Watching for ${profile?.name || 'You'}`}
          items={historyData.map((h) => ({
            item: h.item || h,
            pct:
              h.seconds && h.item?.durationSeconds
                ? (h.seconds / h.item.durationSeconds) * 100
                : null,
          }))}
          shape="landscape"
        />
      ) : null}

      {/* 4. Below-The-Fold: Lazy Rails (Fetched ONLY as user scrolls into view) */}
      <LazyRail
        title="Blockbuster Movies"
        endpoint="/api/catalog/browse?kind=movie"
        shape="landscape"
        queryKey="rail-movies"
      />

      <LazyRail
        title="Binge-Worthy TV Series"
        endpoint="/api/catalog/browse?kind=series"
        shape="portrait"
        queryKey="rail-series"
      />

      <LazyRail
        title="Action & Adventure"
        endpoint="/api/catalog/browse?genre=action"
        shape="landscape"
        queryKey="rail-action"
      />

      <LazyRail
        title="Trending Anime"
        endpoint="/api/catalog/browse?kind=anime"
        shape="portrait"
        queryKey="rail-anime"
      />

      <LazyRail
        title="Drama & Suspense"
        endpoint="/api/catalog/browse?genre=drama"
        shape="landscape"
        queryKey="rail-drama"
      />
    </div>
  );
}
