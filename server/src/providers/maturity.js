/**
 * The one maturity table. Cinemeta, TVmaze and Kitsu each shipped their own derivation and the
 * three disagreed, so the same title could be visible to one profile and hidden from another.
 * Every adapter now funnels through `maturityOf`.
 *
 * @typedef {import('./contract.js').Maturity} Maturity
 */

/**
 * Union of the three adapters' genre sets. Cinemeta contributed animation/family/kids and
 * horror/war/thriller/crime; TVmaze added children and adult/espionage. Kitsu ships no genre
 * table because it has a real certificate, and it contributed none.
 *
 * Adult beats child when a title carries both, because a gate that under-blocks is worse than
 * one that over-blocks.
 */
export const MATURITY_BY_GENRE = new Map([
  ['animation', 'child'],
  ['children', 'child'],
  ['family', 'child'],
  ['kids', 'child'],
  ['adult', 'adult'],
  ['crime', 'adult'],
  ['espionage', 'adult'],
  ['horror', 'adult'],
  ['thriller', 'adult'],
  ['war', 'adult'],
]);

/** An unrecognised genre lands here. `maturityAllowed` only ever blocks downward from it. */
export const DEFAULT_MATURITY = 'teen';

/** What a page or the browse genre filter needs to label a genre chip. */
export const GENRE_VOCABULARY = Object.freeze({
  child: Object.freeze(['animation', 'children', 'family', 'kids']),
  adult: Object.freeze([
    'adult',
    'crime',
    'espionage',
    'horror',
    'thriller',
    'war',
  ]),
});

/**
 * Kitsu's own certificates. Keys are lowercased because upstream label case is not stable.
 *
 * `PG` is `teen` on purpose: Kitsu also files kid-safe shows under `PG | Children`, and the gate
 * errs toward blocking.
 */
const MATURITY_BY_RATING = new Map([
  ['g', 'child'],
  ['all ages', 'child'],
  ['children', 'child'],
  ['pg', 'teen'],
  ['pg-13', 'teen'],
  ['teens 13 or older', 'teen'],
  ['r', 'adult'],
  ['r17', 'adult'],
  ['r18', 'adult'],
  ['17+', 'adult'],
  ['mature', 'adult'],
]);

function label(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * @param {{genres?: string[]|null, ageRating?: string|null, guide?: string|null, nsfw?: boolean}} [source]
 * @returns {Maturity}
 */
export function maturityOf(source = {}) {
  const { genres, ageRating, guide, nsfw } = source;

  // Kitsu refuses `filter[nsfw]` ("nsfw is not allowed"), so a flagged record is only
  // catchable on read.
  if (nsfw === true) return 'adult';

  // A real certificate outranks a genre guess. Kitsu files "Ecchi" and "Horror" under titles
  // rated G, and inferring adult from the genre would block them for no reason.
  const certificate =
    MATURITY_BY_RATING.get(label(ageRating)) ??
    MATURITY_BY_RATING.get(label(guide));
  if (certificate) return certificate;

  let derived = DEFAULT_MATURITY;
  for (const raw of Array.isArray(genres) ? genres : []) {
    const maturity = MATURITY_BY_GENRE.get(label(raw));
    if (maturity === 'adult') return 'adult';
    if (maturity === 'child') derived = 'child';
  }
  return derived;
}
