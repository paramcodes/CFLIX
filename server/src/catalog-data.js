/**
 * The offline fixture, shaped exactly like `CatalogItem` and `Episode` in
 * `server/src/providers/contract.js`: every declared key, nothing extra, and every id
 * namespaced `seed:` so no provider can mint or claim one. Episode ids are derived from
 * their own coordinates (series, season, number), which is how two series stopped minting
 * the same `s2e1`.
 *
 * `scripts/fixture-conformance-check.mjs` fails `npm test` when any of that stops holding.
 */
const episode = (
  seriesId,
  seasonNumber,
  episodeNumber,
  title,
  durationSeconds,
) => ({
  id: `${seriesId}:${seasonNumber}:${episodeNumber}`,
  seriesId,
  seasonNumber,
  episodeNumber,
  title,
  durationSeconds,
  synopsis: null,
  stillUrl: null,
});

export const movies = [
  {
    kind: 'movie',
    id: 'seed:m1',
    title: 'The Dark Knight',
    synopsis: 'Batman raises the stakes in Gotham.',
    posterUrl: '/posters/m1.jpg',
    backdropUrl: null,
    logoUrl: null,
    year: 2008,
    durationSeconds: 9120,
    maturity: 'teen',
    genres: [],
    cast: [],
    rating: null,
    trailerYtId: null,
    provider: 'seed',
  },
  {
    kind: 'movie',
    id: 'seed:m2',
    title: 'Space Odyssey',
    synopsis: 'A trip to Jupiter.',
    posterUrl: '/posters/m2.jpg',
    backdropUrl: null,
    logoUrl: null,
    year: 1968,
    durationSeconds: 8520,
    maturity: 'teen',
    genres: [],
    cast: [],
    rating: null,
    trailerYtId: null,
    provider: 'seed',
  },
  {
    kind: 'movie',
    id: 'seed:m3',
    title: 'Kids Cartoon Movie',
    synopsis: 'A very safe film.',
    posterUrl: '/posters/m3.jpg',
    backdropUrl: null,
    logoUrl: null,
    year: 2020,
    durationSeconds: 5400,
    maturity: 'child',
    genres: [],
    cast: [],
    rating: null,
    trailerYtId: null,
    provider: 'seed',
  },
  {
    kind: 'movie',
    id: 'seed:m4',
    title: 'Red Harvest',
    synopsis: 'Noir detective tale.',
    posterUrl: '/posters/m4.jpg',
    backdropUrl: null,
    logoUrl: null,
    year: 2019,
    durationSeconds: 6600,
    maturity: 'adult',
    genres: [],
    cast: [],
    rating: null,
    trailerYtId: null,
    provider: 'seed',
  },
];

const DARK = 'seed:s1';
const KID_SHOW = 'seed:s2';

export const series = [
  {
    kind: 'series',
    id: DARK,
    title: 'Dark',
    synopsis: 'Time travel in a small town.',
    posterUrl: '/posters/s1.jpg',
    backdropUrl: null,
    logoUrl: null,
    year: 2017,
    durationSeconds: null,
    maturity: 'teen',
    genres: [],
    cast: [],
    rating: null,
    trailerYtId: null,
    provider: 'seed',
    seasonCount: 2,
    episodes: [
      episode(DARK, 1, 1, 'Secret', 3300),
      episode(DARK, 1, 2, 'Lies', 3200),
      episode(DARK, 2, 1, 'Knots', 3100),
    ],
  },
  {
    kind: 'series',
    id: KID_SHOW,
    title: 'Kid Show',
    synopsis: 'Cartoon series for kids.',
    posterUrl: '/posters/s2.jpg',
    backdropUrl: null,
    logoUrl: null,
    year: 2021,
    durationSeconds: null,
    maturity: 'child',
    genres: [],
    cast: [],
    rating: null,
    trailerYtId: null,
    provider: 'seed',
    seasonCount: 1,
    episodes: [episode(KID_SHOW, 1, 1, 'Pilot', 1500)],
  },
];
