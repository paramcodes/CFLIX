import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  InMemorySearchAdapter,
  GenreSimilarityRecommendationAdapter,
} from '../server/src/search/adapters.js';
import type { CatalogItemEntity } from '../server/src/domain/ports.js';

describe('Information Retrieval Adapters (Search & Recs)', () => {
  const searchAdapter = new InMemorySearchAdapter();
  const recsAdapter = new GenreSimilarityRecommendationAdapter();

  const mockItems: CatalogItemEntity[] = [
    {
      kind: 'movie',
      id: 'm1',
      title: 'Inception',
      synopsis: 'A thief steals corporate secrets through dream-sharing.',
      posterUrl: null,
      backdropUrl: null,
      logoUrl: null,
      year: 2010,
      durationSeconds: 8880,
      maturity: 'teen',
      genres: ['Sci-Fi', 'Action', 'Thriller'],
      cast: ['Leonardo DiCaprio'],
      rating: 8.8,
      trailerYtId: null,
      provider: 'seed',
    },
    {
      kind: 'movie',
      id: 'm2',
      title: 'The Dark Knight',
      synopsis: 'Batman raises the stakes in Gotham against the Joker.',
      posterUrl: null,
      backdropUrl: null,
      logoUrl: null,
      year: 2008,
      durationSeconds: 9120,
      maturity: 'teen',
      genres: ['Action', 'Crime', 'Drama'],
      cast: ['Christian Bale'],
      rating: 9.0,
      trailerYtId: null,
      provider: 'seed',
    },
    {
      kind: 'series',
      id: 's1',
      title: 'Dark',
      synopsis: 'A missing child sets four families on a frantic hunt.',
      posterUrl: null,
      backdropUrl: null,
      logoUrl: null,
      year: 2017,
      durationSeconds: null,
      maturity: 'teen',
      genres: ['Sci-Fi', 'Mystery', 'Drama'],
      cast: [],
      rating: 8.7,
      trailerYtId: null,
      provider: 'seed',
    },
  ];

  it('InMemorySearchAdapter filters by title text', async () => {
    const results = await searchAdapter.search('dark', mockItems);
    assert.equal(results.length, 2); // The Dark Knight and Dark
  });

  it('InMemorySearchAdapter filters by kind', async () => {
    const results = await searchAdapter.search('dark', mockItems, {
      kind: 'series',
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 's1');
  });

  it('GenreSimilarityRecommendationAdapter scores titles by shared genre overlap', async () => {
    // Anchor: Inception (Sci-Fi, Action, Thriller)
    // Dark Knight shares: Action (1)
    // Dark shares: Sci-Fi (1)
    const related = await recsAdapter.recommendRelated(mockItems[0], mockItems);
    assert.equal(related.length, 2);
    assert.ok(
      related.every((r) => r.id !== 'm1'),
      'Excludes anchor title',
    );
  });
});
