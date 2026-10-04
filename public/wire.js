const pages = {
  'sign-in': () => import('/js/pages/signin.js'),
  profiles: () => import('/js/pages/profiles.js'),
  home: () => import('/js/pages/home.js'),
  detail: () => import('/js/pages/detail.js'),
  player: () => import('/js/pages/player.js'),
  browse: () => import('/js/pages/browse.js'),
};

const page = document.body.dataset.page;
if (page && pages[page]) pages[page]().then((m) => m.default());
