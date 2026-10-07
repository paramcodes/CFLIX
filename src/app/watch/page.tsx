'use client';

import React, { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  VideoPlayer,
  type VideoPlayerItem,
} from '../../components/player/VideoPlayer';
import { fetchApi } from '../../lib/api';

interface PlaybackResponse {
  item?: VideoPlayerItem & { trailerYtId?: string | null };
  resumeFromSeconds?: number;
}

function WatchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const kind = searchParams.get('kind');

  const {
    data: playback,
    isLoading,
    error,
  } = useQuery<PlaybackResponse>({
    queryKey: ['play', id, kind],
    queryFn: async () => {
      if (!id) throw new Error('No title to play');
      // `POST /api/play` keys every branch on `ref.kind`, so the title and
      // episode screens pass it in the URL. A bare link - a bookmark, or an
      // older share - carries no kind to send; resolve the item once to learn
      // it rather than guessing, because a missing kind answers "unknown media
      // kind" and the player can never start.
      let resolvedKind: string | null | undefined = kind;
      if (!resolvedKind) {
        const item = await fetchApi<{ kind?: string }>(
          `/api/catalog/get?id=${encodeURIComponent(id)}`,
        );
        resolvedKind = item.kind;
      }
      if (!resolvedKind) throw new Error('Unknown media kind');
      return fetchApi<PlaybackResponse>('/api/play', {
        method: 'POST',
        body: { ref: { id, kind: resolvedKind } },
      });
    },
    enabled: !!id,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center text-white">
        Loading stream...
      </div>
    );
  }

  if (error || !playback?.item) {
    return (
      <div className="w-screen h-screen bg-black flex flex-col items-center justify-center text-white p-4">
        <h1 className="text-xl font-bold mb-2">Unable to Play Video</h1>
        <p className="text-neutral-400 text-sm mb-4 text-center">
          {error instanceof Error
            ? error.message
            : 'The stream could not be loaded.'}
        </p>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 bg-neutral-800 rounded hover:bg-neutral-700 text-sm"
        >
          Go Back
        </button>
      </div>
    );
  }

  const item = playback.item;
  const trailerYtId = item.trailerYtId || null;
  const resume = playback.resumeFromSeconds || 0;

  return (
    <VideoPlayer item={item} trailerYtId={trailerYtId} resumeSeconds={resume} />
  );
}

export default function WatchPage() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen bg-black flex items-center justify-center text-white">
          Loading...
        </div>
      }
    >
      <WatchContent />
    </Suspense>
  );
}
