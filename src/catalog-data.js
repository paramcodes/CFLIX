// Seed catalog. Local stand-in for a real catalog service.

export const movies = [
  { kind: 'movie', id: 'm1', title: 'The Dark Knight', synopsis: 'Batman raises the stakes in Gotham.', posterUrl: '/posters/m1.jpg', year: 2008, durationSeconds: 9120, maturity: 'teen' },
  { kind: 'movie', id: 'm2', title: 'Space Odyssey', synopsis: 'A trip to Jupiter.', posterUrl: '/posters/m2.jpg', year: 1968, durationSeconds: 8520, maturity: 'teen' },
  { kind: 'movie', id: 'm3', title: 'Kids Cartoon Movie', synopsis: 'A very safe film.', posterUrl: '/posters/m3.jpg', year: 2020, durationSeconds: 5400, maturity: 'child' },
  { kind: 'movie', id: 'm4', title: 'Red Harvest', synopsis: 'Noir detective tale.', posterUrl: '/posters/m4.jpg', year: 2019, durationSeconds: 6600, maturity: 'adult' },
];

export const series = [
  {
    kind: 'series', id: 's1', title: 'Dark', synopsis: 'Time travel in a small town.', posterUrl: '/posters/s1.jpg', year: 2017, maturity: 'teen',
    seasons: [
      { seasonNumber: 1, episodes: [
        { id: 's1e1', seriesId: 's1', seasonNumber: 1, episodeNumber: 1, title: 'Secret', durationSeconds: 3300 },
        { id: 's1e2', seriesId: 's1', seasonNumber: 1, episodeNumber: 2, title: 'Lies', durationSeconds: 3200 },
      ] },
      { seasonNumber: 2, episodes: [
        { id: 's2e1', seriesId: 's1', seasonNumber: 2, episodeNumber: 1, title: 'Knots', durationSeconds: 3100 },
      ] },
    ],
  },
  {
    kind: 'series', id: 's2', title: 'Kid Show', synopsis: 'Cartoon series for kids.', posterUrl: '/posters/s2.jpg', year: 2021, maturity: 'child',
    seasons: [
      { seasonNumber: 1, episodes: [
        { id: 's2e1', seriesId: 's2', seasonNumber: 1, episodeNumber: 1, title: 'Pilot', durationSeconds: 1500 },
      ] },
    ],
  },
];

export function seriesListing(s) {
  return {
    kind: 'series', id: s.id, title: s.title, synopsis: s.synopsis, posterUrl: s.posterUrl,
    year: s.year, maturity: s.maturity,
    seasonCount: s.seasons.length,
  };
}
