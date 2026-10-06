import type {
  SearchIndexPort,
  RecommendationEnginePort,
  CatalogItemEntity,
} from '../domain/ports.js';

function lower(val: unknown): string {
  return String(val ?? '')
    .trim()
    .toLowerCase();
}

/**
 * In-Memory Search Index Adapter.
 * Provides substring matching with kind filtering and scoring.
 */
export class InMemorySearchAdapter implements SearchIndexPort {
  async search(
    query: string,
    items: CatalogItemEntity[],
    options: { kind?: string | null; limit?: number } = {},
  ): Promise<CatalogItemEntity[]> {
    const q = lower(query);
    const limit = options.limit ?? 20;

    const filtered = items.filter((item) => {
      if (options.kind && item.kind !== options.kind) return false;
      if (!q) return true;
      return lower(item.title).includes(q) || lower(item.synopsis).includes(q);
    });

    return filtered.slice(0, limit);
  }
}

/**
 * Genre Similarity Recommendation Adapter.
 * Recommends related media based on Jaccard/shared genre overlap.
 */
export class GenreSimilarityRecommendationAdapter implements RecommendationEnginePort {
  async recommendRelated(
    anchor: CatalogItemEntity,
    pool: CatalogItemEntity[],
    options: { limit?: number } = {},
  ): Promise<CatalogItemEntity[]> {
    const limit = options.limit ?? 12;
    const candidates = pool.filter((item) => item.id !== anchor.id);

    const anchorGenres = new Set((anchor.genres || []).map(lower));
    if (anchorGenres.size === 0) {
      return candidates.slice(0, limit);
    }

    const scored = candidates
      .map((item) => {
        const itemGenres = (item.genres || []).map(lower);
        const overlap = itemGenres.filter((g) => anchorGenres.has(g)).length;
        return { item, score: overlap };
      })
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || (b.item.rating ?? 0) - (a.item.rating ?? 0),
      );

    const results = scored.map((s) => s.item);
    return results.length > 0
      ? results.slice(0, limit)
      : candidates.slice(0, limit);
  }
}
