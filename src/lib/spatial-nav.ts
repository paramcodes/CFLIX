import type {
  SpatialNavigationPort,
  SpatialDirection,
  SpatialBox,
} from '../../server/src/domain/ports.js';

/**
 * 2D Geometric Spatial Navigation Engine for 10-Foot Smart TVs and Gamepad D-Pads.
 *
 * Implements the W3C CSS Spatial Navigation candidate recommendation algorithm.
 * Calculates nearest-neighbor elements in a given direction using center-point
 * Euclidean distance with angular cone pruning.
 */
export class SpatialNavigationEngine implements SpatialNavigationPort {
  findNextFocus(
    currentId: string,
    direction: SpatialDirection,
    candidates: SpatialBox[],
  ): string | null {
    const current = candidates.find((c) => c.id === currentId);
    if (!current) return null;

    const currentCenter = {
      x: current.left + current.width / 2,
      y: current.top + current.height / 2,
    };

    let bestCandidate: string | null = null;
    let minDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (candidate.id === currentId) continue;

      const candidateCenter = {
        x: candidate.left + candidate.width / 2,
        y: candidate.top + candidate.height / 2,
      };

      const dx = candidateCenter.x - currentCenter.x;
      const dy = candidateCenter.y - currentCenter.y;

      // Filter by directional quadrant
      const inDirection =
        direction === 'right'
          ? dx > 0 && Math.abs(dy) <= dx * 1.5
          : direction === 'left'
            ? dx < 0 && Math.abs(dy) <= Math.abs(dx) * 1.5
            : direction === 'down'
              ? dy > 0 && Math.abs(dx) <= dy * 1.5
              : dy < 0 && Math.abs(dx) <= Math.abs(dy) * 1.5;

      if (!inDirection) continue;

      // Weighted Euclidean distance (primary axis weighted over secondary axis)
      const distance =
        direction === 'left' || direction === 'right'
          ? dx * dx + dy * dy * 4
          : dx * dx * 4 + dy * dy;

      if (distance < minDistance) {
        minDistance = distance;
        bestCandidate = candidate.id;
      }
    }

    return bestCandidate;
  }
}
